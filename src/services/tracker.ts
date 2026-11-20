import {
  collection,
  doc,
  documentId,
  getDocFromServer,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  startAfter,
  Timestamp,
  where,
} from 'firebase/firestore'
import type {
  DocumentData,
  DocumentReference,
  Firestore,
  Query,
  QueryDocumentSnapshot,
  Transaction,
} from 'firebase/firestore'
import type {
  AuditEvent,
  Calendar,
  Course,
  Dose,
  DoseRecord,
  Medicine,
  Owned,
  Pause,
  Row,
  Schedule,
  ScheduleVersion,
  Settings,
  StockEntry,
} from '../domain/models'
import { defaultTiming, MAX_QUANTITY } from '../domain/models'
import { changeStock, dosePlan, inside, sameMark } from '../domain/planning'
import type { DoseChange } from '../domain/planning'
import { addDays, FIRST_INSTANT, LAST_INSTANT, localInstant, rangeBounds } from '../domain/time'

const rows = <T>(docs: QueryDocumentSnapshot[]) =>
  docs.map((snapshot) => ({ ...(snapshot.data() as T), id: snapshot.id }))

export type MedicineInput = Pick<Medicine, 'name' | 'unit' | 'strength' | 'warningDays'>
export type SettingsInput = Omit<Settings, 'ownerId' | 'calendarId'>
const COLLECTIONS = [
  'profile',
  'settings',
  'medicines',
  'courses',
  'scheduleVersions',
  'calendars',
  'pauses',
  'doses',
  'stockLedger',
  'auditEvents',
  'deletion',
] as const

export class Tracker {
  readonly db: Firestore
  readonly uid: string

  constructor(db: Firestore, uid: string) {
    this.db = db
    this.uid = uid
  }

  group(name: (typeof COLLECTIONS)[number]) {
    return collection(this.db, 'users', this.uid, name)
  }

  watchRows<T>(
    source: Query,
    receive: (data: Row<T>[], fresh: boolean) => void,
    fail: (error: Error) => void
  ) {
    return onSnapshot(
      source,
      { includeMetadataChanges: true },
      (snapshot) =>
        receive(
          rows<T>(snapshot.docs),
          !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites
        ),
      fail
    )
  }

  watchSettings(
    receive: (settings: Settings | null, fresh: boolean) => void,
    fail: (error: Error) => void
  ) {
    return onSnapshot(
      doc(this.group('settings'), 'main'),
      { includeMetadataChanges: true },
      (snapshot) =>
        receive(
          snapshot.exists() ? (snapshot.data() as Settings) : null,
          !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites
        ),
      fail
    )
  }

  overlapping(name: 'scheduleVersions' | 'calendars' | 'pauses', first: string, last: string) {
    const { from, until } = rangeBounds(first, last)
    return query(
      this.group(name),
      where('until', '>', from),
      where('from', '<', until),
      orderBy('until'),
      orderBy('from')
    )
  }

  doseRange(first: string, last: string) {
    return query(
      this.group('doses'),
      where('logicalDate', '>=', first),
      where('logicalDate', '<=', last),
      orderBy('logicalDate')
    )
  }

  async auditHistory(field: 'entityId' | 'medicineId', id: string, after?: QueryDocumentSnapshot) {
    const source = query(
      this.group('auditEvents'),
      where(field, '==', id),
      orderBy('at', 'desc'),
      ...(after ? [startAfter(after)] : []),
      limit(25)
    )
    const result = await getDocsFromServer(source)
    return {
      rows: rows<AuditEvent>(result.docs),
      cursor: result.size === 25 ? result.docs.at(-1) : undefined,
    }
  }

  async stockHistory(id: string, after?: QueryDocumentSnapshot) {
    const source = query(
      this.group('stockLedger'),
      where('medicineId', '==', id),
      orderBy('at', 'desc'),
      ...(after ? [startAfter(after)] : []),
      limit(25)
    )
    const result = await getDocsFromServer(source)
    return {
      rows: rows<StockEntry>(result.docs),
      cursor: result.size === 25 ? result.docs.at(-1) : undefined,
    }
  }

  private audit(transaction: Transaction, id: string, event: Omit<AuditEvent, keyof Owned>) {
    transaction.set(doc(this.group('auditEvents'), id), { ...event, ownerId: this.uid })
  }

  private ledger(transaction: Transaction, id: string, entry: Omit<StockEntry, keyof Owned>) {
    transaction.set(doc(this.group('stockLedger'), id), { ...entry, ownerId: this.uid })
  }

  async initialize(name: string) {
    const settings = doc(this.group('settings'), 'main')
    const calendar = doc(this.group('calendars'))
    await runTransaction(this.db, async (transaction) => {
      if ((await transaction.get(settings)).exists()) return
      transaction.set(doc(this.group('profile'), 'main'), {
        ownerId: this.uid,
        name: name.slice(0, 100),
      })
      transaction.set(calendar, {
        ownerId: this.uid,
        ...defaultTiming,
        from: FIRST_INSTANT,
        until: LAST_INSTANT,
      } satisfies Calendar)
      transaction.set(settings, {
        ownerId: this.uid,
        calendarId: calendar.id,
        ...defaultTiming,
        reminders: false,
        repeatMinutes: 15,
        repeats: 5,
        privateText: true,
      } satisfies Settings)
    })
  }

  async saveSettings(input: SettingsInput, expectedCalendarId: string) {
    // Validate the zone even when no dose has been scheduled.
    if (!/^(UTC|[A-Za-z_+-]+(?:\/[A-Za-z0-9_+.-]+)+)$/.test(input.zone))
      throw new Error('Укажите часовой пояс IANA.')
    localInstant('2000-01-01', input.boundary, input.zone)
    const settingsRef = doc(this.group('settings'), 'main')
    const newCalendar = doc(this.group('calendars'))
    await runTransaction(this.db, async (transaction) => {
      const current = await required<Settings>(transaction, settingsRef)
      if (expectedCalendarId !== current.calendarId) throw stale()
      const changed = current.zone !== input.zone || current.boundary !== input.boundary
      if (changed) {
        const previousRef = doc(this.group('calendars'), current.calendarId)
        const previous = await required<Calendar>(transaction, previousRef)
        const at = cutover(previous.from)
        transaction.update(previousRef, { until: at })
        transaction.set(newCalendar, {
          ownerId: this.uid,
          zone: input.zone,
          boundary: input.boundary,
          from: at,
          until: LAST_INSTANT,
        } satisfies Calendar)
      }
      transaction.update(settingsRef, {
        ...input,
        calendarId: changed ? newCalendar.id : current.calendarId,
      })
    })
  }

  async saveMedicine(
    input: MedicineInput,
    schedule: Schedule,
    initialStock: number,
    previous?: { medicine: Row<Medicine>; course: Row<Course>; version: Row<ScheduleVersion> }
  ) {
    const medicine = previous
      ? doc(this.group('medicines'), previous.medicine.id)
      : doc(this.group('medicines'))
    const course = previous
      ? doc(this.group('courses'), previous.course.id)
      : doc(this.group('courses'))
    const version = doc(this.group('scheduleVersions'))
    await runTransaction(this.db, async (transaction) => {
      const at = Timestamp.now()
      const oldMedicine = previous ? await required<Medicine>(transaction, medicine) : undefined
      const oldCourse = previous ? await required<Course>(transaction, course) : undefined
      const oldVersionRef = oldCourse
        ? doc(this.group('scheduleVersions'), oldCourse.versionId)
        : undefined
      const oldVersion = oldVersionRef
        ? await required<ScheduleVersion>(transaction, oldVersionRef)
        : undefined
      const settings = await required<Settings>(transaction, doc(this.group('settings'), 'main'))
      const startsAt = localInstant(schedule.start, settings.boundary, settings.zone)
      let from = startsAt.toMillis() < at.toMillis() ? startsAt : at
      // A first version can be backdated. Subsequent versions affect future slots only.
      if (oldVersion && oldCourse && oldVersionRef) {
        if (
          oldCourse.endedAt ||
          oldMedicine?.archived ||
          oldCourse.revision !== previous?.course.revision
        )
          throw stale()
        from = cutover(oldVersion.from)
        transaction.update(oldVersionRef, { until: from })
        transaction.update(course, { versionId: version.id, revision: oldCourse.revision + 1 })
        transaction.update(medicine, { ...input })
      } else {
        transaction.set(medicine, {
          ...input,
          ownerId: this.uid,
          stock: initialStock,
          stockEventId: `initial_${medicine.id}`,
          archived: false,
          currentCourseId: course.id,
        } satisfies Medicine)
        transaction.set(course, {
          ownerId: this.uid,
          medicineId: medicine.id,
          versionId: version.id,
          revision: 1,
          endedAt: null,
          manualPauseId: null,
        } satisfies Course)
        this.ledger(transaction, `initial_${medicine.id}`, {
          medicineId: medicine.id,
          doseId: null,
          delta: initialStock,
          balance: initialStock,
          kind: 'initial',
          at,
        })
      }
      transaction.set(version, {
        ...schedule,
        ownerId: this.uid,
        medicineId: medicine.id,
        courseId: course.id,
        name: input.name,
        unit: input.unit,
        from,
        until: LAST_INSTANT,
      } satisfies ScheduleVersion)
      this.audit(transaction, `schedule_${version.id}`, {
        entityId: medicine.id,
        medicineId: medicine.id,
        action: previous ? 'schedule_updated' : 'medicine_created',
        at: previous ? from : at,
        before: oldVersion ? { medicine: oldMedicine, schedule: oldVersion } : null,
        after: { ...input, ...schedule, versionId: version.id },
      })
    })
    return medicine.id
  }

  async changeCourse(
    medicine: Row<Medicine>,
    course: Row<Course>,
    operation: 'pause' | 'resume' | 'dates' | 'end' | 'archive' | 'restart',
    dates?: { first: string; last: string }
  ) {
    const courseRef = doc(this.group('courses'), course.id)
    const medicineRef = doc(this.group('medicines'), medicine.id)
    const pauseRef = doc(this.group('pauses'))
    const eventRef = doc(this.group('auditEvents'))
    const nextCourse = doc(this.group('courses'))
    const nextVersion = doc(this.group('scheduleVersions'))
    await runTransaction(this.db, async (transaction) => {
      const live = await required<Course>(transaction, courseRef)
      const med = await required<Medicine>(transaction, medicineRef)
      const at = Timestamp.now()
      const previousPauseRef = live.manualPauseId
        ? doc(this.group('pauses'), live.manualPauseId)
        : undefined
      const previousPause =
        previousPauseRef && operation === 'resume'
          ? await required<Pause>(transaction, previousPauseRef)
          : undefined
      if (
        live.revision !== course.revision ||
        med.currentCourseId !== course.id ||
        (med.archived && operation !== 'restart') ||
        (live.endedAt && operation !== 'archive' && operation !== 'restart')
      )
        throw stale()

      const update: Partial<Course> = { revision: live.revision + 1 }
      if (operation === 'restart') {
        const version = await required<ScheduleVersion>(
          transaction,
          doc(this.group('scheduleVersions'), live.versionId)
        )
        const settings = await required<Settings>(transaction, doc(this.group('settings'), 'main'))
        const naturalEnd =
          version.end &&
          localInstant(addDays(version.end, 1), settings.boundary, settings.zone).toMillis()
        if (!live.endedAt && (!naturalEnd || naturalEnd > at.toMillis())) throw stale()
        if (!live.endedAt) update.endedAt = at
        transaction.set(nextCourse, {
          ownerId: this.uid,
          medicineId: medicine.id,
          versionId: nextVersion.id,
          revision: 1,
          endedAt: null,
          manualPauseId: null,
        } satisfies Course)
        transaction.set(nextVersion, {
          ...version,
          courseId: nextCourse.id,
          from: at,
          until: LAST_INSTANT,
          end: null,
          start: dates!.first,
          name: med.name,
          unit: med.unit,
        } satisfies ScheduleVersion)
        transaction.update(medicineRef, { archived: false, currentCourseId: nextCourse.id })
      } else if (operation === 'pause') {
        if (live.manualPauseId) return
        update.manualPauseId = pauseRef.id
        transaction.set(pauseRef, {
          ownerId: this.uid,
          courseId: course.id,
          from: at,
          until: LAST_INSTANT,
          mode: 'manual',
        } satisfies Pause)
      } else if (operation === 'resume') {
        if (!previousPause || !previousPauseRef) return
        update.manualPauseId = null
        transaction.update(previousPauseRef, { until: cutover(previousPause.from) })
      } else if (operation === 'dates' && dates) {
        const settings = await required<Settings>(transaction, doc(this.group('settings'), 'main'))
        const start = localInstant(dates.first, settings.boundary, settings.zone)
        const until = localInstant(addDays(dates.last, 1), settings.boundary, settings.zone)
        const from = start.toMillis() > at.toMillis() ? start : at
        if (until.toMillis() <= from.toMillis() || dates.last < dates.first)
          throw new Error('Укажите будущий период паузы.')
        transaction.set(pauseRef, {
          ownerId: this.uid,
          courseId: course.id,
          from,
          until,
          mode: 'dates',
        } satisfies Pause)
      } else {
        update.endedAt = live.endedAt ?? at
        if (operation === 'archive') transaction.update(medicineRef, { archived: true })
      }
      transaction.update(courseRef, update)
      this.audit(transaction, eventRef.id, {
        medicineId: medicine.id,
        entityId: course.id,
        action: operation,
        at,
        before: { ...live },
        after: {
          ...update,
          ...(dates && { dates }),
          ...(operation === 'restart' && { courseId: nextCourse.id }),
        },
      })
    })
  }

  async updateStock(medicineId: string, kind: 'restock' | 'inventory', quantity: number) {
    if (kind === 'restock' && quantity <= 0)
      throw new Error('Укажите положительное количество для пополнения.')
    const operation = doc(this.group('stockLedger'))
    const medicineRef = doc(this.group('medicines'), medicineId)
    await runTransaction(this.db, async (transaction) => {
      const medicine = await required<Medicine>(transaction, medicineRef)
      const at = Timestamp.now()
      const balance = kind === 'restock' ? medicine.stock + quantity : quantity
      if (balance > MAX_QUANTITY) throw new Error('Новый остаток превышает допустимое значение.')
      if (balance === medicine.stock) return
      transaction.update(medicineRef, { stock: balance, stockEventId: operation.id })
      this.ledger(transaction, operation.id, {
        medicineId,
        kind,
        balance,
        doseId: null,
        delta: balance - medicine.stock,
        at,
      })
      this.audit(transaction, operation.id, {
        entityId: medicineId,
        medicineId,
        action: kind,
        at,
        before: { stock: medicine.stock },
        after: { stock: balance },
      })
    })
  }

  async saveDose(dose: Dose, next: DoseChange, quick = false) {
    if (dose.status === 'canceled') throw stale()
    const doseRef = doc(this.group('doses'), dose.id)
    const medicineRef = doc(this.group('medicines'), dose.medicineId)
    let previousStockEvent: string | undefined
    const save = () =>
      runTransaction(this.db, async (transaction) => {
        const snap = await transaction.get(doseRef)
        const previous = snap.exists() ? (snap.data() as DoseRecord) : undefined
        if (sameMark(previous, next) || (quick && previous && previous.status !== 'pending')) return
        if ((previous?.revision ?? 0) !== (dose.record?.revision ?? 0)) throw stale()
        if (!previous) {
          const course = await required<Course>(
            transaction,
            doc(this.group('courses'), dose.courseId)
          )
          const version = await required<ScheduleVersion>(
            transaction,
            doc(this.group('scheduleVersions'), dose.versionId)
          )
          const calendar = await required<Calendar>(
            transaction,
            doc(this.group('calendars'), dose.calendarId)
          )
          const ms = dose.scheduledAt.toMillis()
          if (
            course.revision !== dose.courseRevision ||
            !inside(ms, version) ||
            !inside(ms, calendar) ||
            (course.endedAt && ms >= course.endedAt.toMillis())
          )
            throw stale()
        }
        const medicine = await required<Medicine>(transaction, medicineRef)
        previousStockEvent = medicine.stockEventId
        const at = Timestamp.now()
        const revision = (previous?.revision ?? 0) + 1
        const id = `dose_${dose.id}_${revision}`
        const record: DoseRecord = { ...dosePlan(dose), ...next, revision, recordedAt: at }
        transaction.set(doseRef, record)
        const delta = changeStock(previous, next)
        if (delta !== 0) {
          const balance = medicine.stock + delta
          if (Math.abs(balance) > MAX_QUANTITY)
            throw new Error('Остаток вне допустимого диапазона.')
          transaction.update(medicineRef, { stock: balance, stockEventId: id })
          this.ledger(transaction, id, {
            medicineId: dose.medicineId,
            doseId: dose.id,
            delta,
            balance,
            kind: previous ? 'correction' : 'dose',
            at,
          })
        }
        this.audit(transaction, id, {
          medicineId: dose.medicineId,
          entityId: dose.id,
          action: 'dose_changed',
          at,
          before: previous ? { ...previous } : null,
          after: { ...record },
        })
      })
    // Some concurrent writes are rejected by the rules before the server can
    // return a retryable transaction conflict. Recheck the state before retrying.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await save()
        return
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !('code' in error) ||
          error.code !== 'permission-denied' ||
          attempt >= 2
        )
          throw error
        const current = (await getDocFromServer(doseRef)).data() as DoseRecord | undefined
        if (sameMark(current, next) || (quick && current && current.status !== 'pending')) return
        if ((current?.revision ?? 0) !== (dose.record?.revision ?? 0)) throw stale()
        const medicine = (await getDocFromServer(medicineRef)).data() as Medicine | undefined
        if (!previousStockEvent || !medicine || medicine.stockEventId === previousStockEvent)
          throw error
      }
    }
  }

  async requestDeletion() {
    const ref = doc(this.group('deletion'), 'main')
    await runTransaction(this.db, async (transaction) => {
      if (!(await transaction.get(ref)).exists()) {
        transaction.set(ref, { ownerId: this.uid, requestedAt: Timestamp.now() })
      }
    })
  }

  async exportAll() {
    const result: Record<string, unknown[]> = {}
    for (const name of COLLECTIONS) {
      result[name] = []
      let cursor: QueryDocumentSnapshot | undefined
      for (;;) {
        const page = await getDocsFromServer(
          query(
            this.group(name),
            orderBy(documentId()),
            ...(cursor ? [startAfter(cursor)] : []),
            limit(400)
          )
        )
        result[name].push(...rows(page.docs))
        if (page.size < 400) break
        cursor = page.docs.at(-1)
      }
    }
    return { schemaVersion: 1, exportedAt: new Date().toISOString(), ...result }
  }
}

function cutover(from: Timestamp) {
  return Timestamp.fromMillis(Math.max(Date.now(), from.toMillis() + 1))
}

function stale() {
  return new Error('Данные изменились. Откройте карточку повторно.')
}

async function required<T>(transaction: Transaction, ref: DocumentReference<DocumentData>) {
  const snapshot = await transaction.get(ref)
  if (!snapshot.exists()) throw stale()
  return snapshot.data() as T
}
