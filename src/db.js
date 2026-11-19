import { client } from './client'

// تاريخ بصيغة YYYY-MM-DD (بأصفار) لعمود date في Supabase
export const isoKey = (d) =>
  d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')

// أي خطأ من Supabase يتحول لاستثناء برسالة واضحة
const check = ({ data, error }, what) => {
  if (error) throw new Error(what + ': ' + error.message)
  return data
}

// نهرّب رموز LIKE عشان الكلمة المفتاحية تتعامل كنص عادي
const esc = (s) => s.replace(/[\\%_]/g, (m) => '\\' + m)

// ===== تحليل الكلمة كتاريخ: YYYY-MM-DD أو YYYY-MM أو YYYY أو DD-MM-YYYY (أرقام عربية أو إنجليزية، وفاصل - أو /) =====
const pad = (n) => String(n).padStart(2, '0')
const toLatin = (s) => s.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
function parseDateTerm(raw) {
  const s = toLatin(raw.trim()).replace(/[\/.\s]+/g, '-').replace(/-+/g, '-')
  let m
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return dayRange(+m[1], +m[2], +m[3])
  if ((m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/))) return dayRange(+m[3], +m[2], +m[1])
  if ((m = s.match(/^(\d{4})-(\d{1,2})$/))) {
    const y = +m[1], mo = +m[2]
    if (mo < 1 || mo > 12) return null
    return { from: `${y}-${pad(mo)}-01`, to: mo === 12 ? `${y + 1}-01-01` : `${y}-${pad(mo + 1)}-01` }
  }
  if ((m = s.match(/^(\d{4})$/))) return { from: `${m[1]}-01-01`, to: `${+m[1] + 1}-01-01` }
  return null
}
function dayRange(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const iso = `${y}-${pad(mo)}-${pad(d)}`
  return { from: iso, to: addDays(iso, 1) }
}

// ===== تسجيل الدخول والخروج (اختياري: التطبيق بيشتغل بدون تسجيل دخول) =====
// الرابط اللي بيرجّع له المستخدم بعد تأكيد البريد: رابط الموقع المنشور (مش localhost)
// اضبطيه في ملف .env للنشر:  VITE_SITE_URL=https://your-app.vercel.app
const SITE_URL = ((import.meta.env && import.meta.env.VITE_SITE_URL) || window.location.origin).replace(/\/$/, '')

const authCheck = ({ data, error }) => {
  if (error) throw new Error(error.message)
  return data
}
export const signIn = async (email, password) => authCheck(await client.auth.signInWithPassword({ email, password }))
export const signUp = async (email, password) =>
  authCheck(await client.auth.signUp({ email, password, options: { emailRedirectTo: SITE_URL } }))
export const resetPassword = async (email) => {
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: SITE_URL })
  if (error) throw new Error(error.message)
}
export const signOut = async () => { const { error } = await client.auth.signOut(); if (error) throw new Error(error.message) }
export const getSession = async () => { const { data } = await client.auth.getSession(); return data ? data.session : null }
// بيرجّع دالة لإيقاف الاشتراك
export const onAuth = (cb) => {
  const { data } = client.auth.onAuthStateChange((_event, session) => cb(session))
  return () => data.subscription.unsubscribe()
}

// تحميل البيانات مرة واحدة (القرّاء، التعيينات، ملاحظات الخدمات)
export async function loadAll() {
  const [readers, assignments, serviceNotes] = await Promise.all([
    client.from('readers').select('id, name, notes, active').order('name'),
    client.from('assignments').select('service_date, service, reading_id, reading_title, readers(name)').order('id'),
    client.from('service_notes').select('service_date, service, note'),
  ])
  return {
    readers: check(readers, 'تحميل القرّاء'),
    assignments: check(assignments, 'تحميل التعيينات'),
    serviceNotes: check(serviceNotes, 'تحميل ملاحظات الخدمات'),
  }
}

// ===== البحث التلقائي في حقل القارئ: نتائج مطابقة جزئياً (بحد أقصى limit) =====
export async function searchReaders(keyword, limit = 5) {
  const k = keyword.trim()
  if (!k) return []
  return check(
    await client
      .from('readers')
      .select('id, name')
      .ilike('name', '%' + esc(k) + '%')
      .or('active.is.null,active.eq.true')
      .order('name')
      .limit(limit),
    'البحث عن قارئ'
  )
}

// أيام (من service_notes) مع العمود occasion لو موجود، وإلا من غيره
async function queryDays(build) {
  for (const cols of ['service_date, service, note, occasion', 'service_date, service, note']) {
    const withOcc = cols.includes('occasion')
    const r = await build(client.from('service_notes').select(cols), withOcc)
    if (!r.error) return r.data || []
    if (!(withOcc && /occasion/i.test(r.error.message))) throw new Error('البحث في الأيام: ' + r.error.message)
  }
  return []
}

// ===== البحث الشامل: قرّاء + قراءات + أيام (بالتاريخ أو باسم العيد/المناسبة) =====
export async function searchAll(keyword, limit = 20) {
  const k = keyword.trim()
  if (!k) return { readers: [], readings: [], days: [], isDate: false }
  const sel = 'service_date, service, reading_id, reading_title, readers!inner(name)'

  // 1) الكلمة تاريخ: نجيب تعيينات وملاحظات الفترة دي
  const range = parseDateTerm(k)
  if (range) {
    const [as, days] = await Promise.all([
      client.from('assignments').select(sel).gte('service_date', range.from).lt('service_date', range.to)
        .order('service_date', { ascending: false }).order('id').limit(120),
      queryDays((q) => q.gte('service_date', range.from).lt('service_date', range.to).order('service_date', { ascending: false }).limit(60)),
    ])
    return { readers: [], readings: check(as, 'البحث بالتاريخ'), days, isDate: true }
  }

  // 2) الكلمة نص: قرّاء + عناوين قراءات + أسماء قرّاء في التعيينات + ملاحظات/مناسبات الأيام
  const p = '%' + esc(k) + '%'
  const safe = '%' + k.replace(/[,()*%_\\]/g, ' ').trim() + '%'   // داخل or() الفواصل والأقواس ممنوعة

  const [rd, byTitle, byReader, days] = await Promise.all([
    client.from('readers').select('id, name').ilike('name', p).order('name').limit(10),
    client.from('assignments').select(sel).ilike('reading_title', p).order('service_date', { ascending: false }).limit(limit),
    client.from('assignments').select(sel).ilike('readers.name', p).order('service_date', { ascending: false }).limit(limit),
    queryDays((q, withOcc) => q.or(withOcc ? `note.ilike.${safe},occasion.ilike.${safe}` : `note.ilike.${safe}`)
      .order('service_date', { ascending: false }).limit(limit)),
  ])

  // دمج نتائج القراءات من الاستعلامين بدون تكرار
  const seen = new Set()
  const readings = [...check(byTitle, 'البحث في القراءات'), ...check(byReader, 'البحث في القراءات')].filter((r) => {
    const id = r.service_date + '|' + r.service + '|' + r.reading_id + '|' + (r.readers && r.readers.name)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
  readings.sort((a, b) => (a.service_date < b.service_date ? 1 : -1))

  return { readers: check(rd, 'البحث عن القرّاء'), readings, days, isDate: false }
}

// يرجّع خريطة { اسم القارئ: id }، ويضيف الأسماء الجديدة بدون خطأ تكرار
async function ensureReaders(names) {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  if (!unique.length) return {}

  const read = async () => check(await client.from('readers').select('id, name').in('name', unique), 'قراءة القرّاء')
  let rows = await read()
  const have = new Set(rows.map((r) => r.name))
  const missing = unique.filter((n) => !have.has(n))

  if (missing.length) {
    // ignoreDuplicates: لو الاسم اتضاف في نفس اللحظة ما يطلعش خطأ تكرار
    check(
      await client.from('readers').upsert(missing.map((name) => ({ name })), { onConflict: 'name', ignoreDuplicates: true }),
      'إضافة قارئ جديد'
    )
    rows = await read()
  }
  return Object.fromEntries(rows.map((r) => [r.name, r.id]))
}

/**
 * حفظ تعيينات خدمة في يوم معين: تعديل (UPDATE) أو إضافة (INSERT) أو حذف، بدون أي خطأ تكرار
 * readings: [{ id, title, names: [...], multi: true|false }, ...]
 * occasions: أسماء المناسبات (اختياري) بتتخزن عشان البحث باسم العيد
 * القراءات الفاضية بتتخطى (مفيش صف) ولا تسبب خطأ
 */
export async function saveAssignments({ date, service, readings, occasions = [] }) {
  const day = isoKey(date)
  const readerIds = await ensureReaders(readings.flatMap((r) => r.names || []))

  const current = check(
    await client.from('assignments').select('id, reading_id, reader_id').eq('service_date', day).eq('service', service),
    'قراءة التعيينات'
  )
  const byReading = {}
  current.forEach((c) => { (byReading[c.reading_id] = byReading[c.reading_id] || []).push(c) })

  const inserts = new Map()              // مفتاح (قراءة|قارئ) عشان ما يتكررش في نفس الحفظ
  const updates = []
  const deletes = new Set()

  readings.forEach((r) => {
    const names = [...new Set((r.names || []).map((n) => n.trim()).filter(Boolean))]
    const wantedIds = [...new Set(names.map((n) => readerIds[n]).filter(Boolean))]
    const existing = byReading[r.id] || []
    const base = { service_date: day, service, reading_id: r.id, reading_title: r.title }
    const add = (id) => inserts.set(r.id + '|' + id, { ...base, reader_id: id })

    // قراءة بأكتر من قارئ: نقارن المجموعتين
    if (r.multi) {
      const have = existing.map((e) => e.reader_id)
      existing.filter((e) => !wantedIds.includes(e.reader_id)).forEach((e) => deletes.add(e.id))
      wantedIds.filter((id) => !have.includes(id)).forEach(add)
      return
    }

    // قراءة بقارئ واحد
    const wantedId = wantedIds[0]
    if (!wantedId) { existing.forEach((e) => deletes.add(e.id)); return }            // فاضية: مفيش صف

    const same = existing.find((e) => e.reader_id === wantedId)
    if (same) {                                                                         // نفس القارئ: مفيش تغيير
      existing.filter((e) => e.id !== same.id).forEach((e) => deletes.add(e.id))
      return
    }
    if (existing.length) {                                                              // القارئ اتغيّر: UPDATE
      const [first, ...rest] = existing
      updates.push({ id: first.id, reader_id: wantedId, reading_title: r.title })
      rest.forEach((e) => deletes.add(e.id))
      return
    }
    add(wantedId)                                                                       // سجل جديد: INSERT
  })

  // 1) التعديلات
  for (const u of updates) {
    check(await client.from('assignments').update({ reader_id: u.reader_id, reading_title: u.reading_title }).eq('id', u.id), 'تعديل تعيين')
  }

  // 2) الإضافات: upsert بتتجاهل أي صف موجود فعلاً (مفيش خطأ تكرار)
  const rows = [...inserts.values()]
  if (rows.length) {
    let r = await client.from('assignments').upsert(rows, { onConflict: 'service_date,service,reading_id,reader_id', ignoreDuplicates: true })
    if (r.error && r.error.code === '42P10') r = await client.from('assignments').insert(rows)   // القيد الفريد لسه مش متعمل: إدخال عادي
    check(r, 'إضافة تعيينات')
  }

  // 3) الحذف
  if (deletes.size) check(await client.from('assignments').delete().in('id', [...deletes]), 'حذف تعيينات')

  // 4) تخزين اسم المناسبة لليوم (للبحث). لو فشل ما نوقفش الحفظ
  if (occasions.length) {
    const r = await client.from('service_notes').upsert(
      { service_date: day, service, occasion: occasions.join('، ') },
      { onConflict: 'service_date,service' }
    )
    if (r.error) console.warn('تعذّر حفظ اسم المناسبة (تأكدي من عمود occasion):', r.error.message)
  }

  return { inserted: rows.length, updated: updates.length, deleted: deletes.size }
}

// حفظ ملاحظات خدمة (إضافة لو جديدة، تحديث لو موجودة)
export async function saveServiceNotes({ date, service, note }) {
  check(
    await client.from('service_notes').upsert(
      { service_date: isoKey(date), service, note: note ?? '' },
      { onConflict: 'service_date,service' }
    ),
    'حفظ ملاحظات الخدمة'
  )
}

// حفظ ملاحظات قارئ (إضافة القارئ لو مش موجود، تحديث لو موجود)
export async function saveReaderNote(name, notes) {
  check(
    await client.from('readers').upsert({ name: name.trim(), notes: notes ?? '' }, { onConflict: 'name' }),
    'حفظ ملاحظات القارئ'
  )
}