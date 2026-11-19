import React, { useState, useMemo, useEffect, useRef } from 'react'
import axios from 'axios'
import htm from 'htm'
import { ThemeProvider, Snackbar, Alert, createTheme, CssBaseline, AppBar, Toolbar, Box, Typography, Chip, Card, CardActionArea, Button, Autocomplete, TextField, IconButton, Dialog, DialogTitle, DialogContent, DialogActions, Drawer, Tooltip, Container, InputAdornment, CircularProgress, Skeleton } from '@mui/material'
import logo from './logo.png'
import { loadAll, saveAssignments, saveServiceNotes, saveReaderNote, searchReaders, searchAll, signIn, signUp, signOut, resetPassword, getSession, onAuth } from './db'

const html = htm.bind(React.createElement);

const BLUE = 'var(--blue)', GOLD = 'var(--gold)';
const GOLD_LINE = 'var(--goldline)';
const DARK_BLUE = '#1E3A8A', DARK_BLUE_HOVER = '#16306f';   // الأزرق الغامق للأزرار الرئيسية

const makeTheme = (mode) => createTheme({
  direction: 'rtl',
  palette: { mode, primary: { main: mode === 'dark' ? '#9db8e8' : DARK_BLUE }, secondary: { main: '#d97706' }, background: { default: mode === 'dark' ? '#0f1419' : '#ffffff', paper: mode === 'dark' ? '#171d26' : '#FFFFFF' } },
  shape: { borderRadius: 10 },
  components: {
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiButton: { styleOverrides: { containedPrimary: { backgroundColor: DARK_BLUE, color: '#fff', '&:hover': { backgroundColor: DARK_BLUE_HOVER } } } },
  },
  typography: { fontFamily: "'Cairo','Segoe UI',Tahoma,sans-serif", button: { fontWeight: 600 } },
});

// كل الخدمات الممكنة. base = نوع القراءات والأيقونة
const ALL_SERVICES = [
  { id: 'liturgy', base: 'liturgy', title: 'القداس الإلهي', stat: 'القداس' },
  { id: 'liturgy2', base: 'liturgy', title: 'القداس الإلهي الثاني', stat: 'القداس' },
  { id: 'matins', base: 'matins', title: 'صلاة باكر', stat: 'باكر' },
  { id: 'vespers', base: 'vespers', title: 'صلاة عشية', stat: 'عشية' },
];

// كروت الصفحة الرئيسية (دايماً ثلاثة)
const HOME_CARDS = [
  { id: 'liturgy', base: 'liturgy', title: 'القداس الإلهي' },
  { id: 'matins', base: 'matins', title: 'صلاة باكر' },
  { id: 'vespers', base: 'vespers', title: 'صلاة عشية' },
];

// ===== هيكلة القراءات: multi = true تقبل أكتر من قارئ، false قارئ واحد =====
const R = (id, title, multi = true) => ({ id, title, multi });

// القداس: قبطي وعربي لكل قراءة + السنكسار + خدمة الهيكل
const LITURGY_READINGS = [
  R('paul_cop', 'البولس (قبطي)'), R('paul_ar', 'البولس (عربي)', false),
  R('cath_cop', 'الكاثوليكون (قبطي)'), R('cath_ar', 'الكاثوليكون (عربي)', false),
  R('acts_cop', 'الإبركسيس (قبطي)'), R('acts_ar', 'الإبركسيس (عربي)', false),
  R('psalm_cop', 'المزمور (قبطي)'), R('psalm_ar', 'المزمور (عربي)'),
  R('gospel_cop', 'الإنجيل (قبطي)'), R('gospel_ar', 'الإنجيل (عربي)', false),
  R('synaxarium', 'السنكسار', false),
  R('altar_service', 'خدمة الهيكل'),
];
// باكر وعشية: مزمور قبطي، إنجيل قبطي وعربي، خدمة الهيكل (الإنجيل العربي بقارئ واحد)
const MATINS_PSALM = R('matins_psalm_cop', 'مزمور باكر (قبطي)');
const MATINS_REST = [R('matins_gospel_cop', 'إنجيل باكر (قبطي)'), R('matins_gospel_ar', 'إنجيل باكر (عربي)', false), R('matins_altar', 'خدمة هيكل باكر')];
const VESPERS_READINGS = [R('vespers_psalm_cop', 'مزمور عشية (قبطي)'), R('vespers_gospel_cop', 'إنجيل عشية (قبطي)'), R('vespers_gospel_ar', 'إنجيل عشية (عربي)', false), R('vespers_altar', 'خدمة هيكل عشية')];
const MATINS_PROPHECIES = R('matins_prophecies', 'نبوات باكر');
const CROSS_MATINS = [R('cross_matins_tour', 'إناجيل دورة باكر (عيد الصليب)'), R('cross_matins_trouh', 'طروحات باكر (عيد الصليب)')];
const CROSS_VESPERS = R('cross_vespers_trouh', 'طروحات عشية (عيد الصليب)');

// قاموس كل القراءات (للبحث عن الاسم العربي ونوع القراءة من المعرّف)
const READING_META = Object.fromEntries([...LITURGY_READINGS, MATINS_PSALM, ...MATINS_REST, ...VESPERS_READINGS, MATINS_PROPHECIES, ...CROSS_MATINS, CROSS_VESPERS].map((r) => [r.id, r]));
// معرّفات قديمة محفوظة في القاعدة قبل التقسيم (قبطي/عربي)
const LEGACY_TITLES = {
  paul: 'البولس', cath: 'الكاثوليكون', acts: 'الإبركسيس', gospel: 'الإنجيل',
  matins_psalm: 'مزمور باكر', matins_gospel: 'إنجيل باكر', vespers_psalm: 'مزمور عشية', vespers_gospel: 'إنجيل عشية',
};
const isMulti = (rid) => !!(READING_META[rid] && READING_META[rid].multi);
const staticTitle = (rid) => (READING_META[rid] && READING_META[rid].title) || LEGACY_TITLES[rid];

// عنوان القراءة بدون (قبطي/عربي) + اللغة كشارة منفصلة
const baseTitle = (t) => t.replace(/\s*\((قبطي|عربي)\)\s*/, '').trim();
const langOf = (id) => id.endsWith('_cop') ? 'قبطي' : id.endsWith('_ar') ? 'عربي' : null;
const partnerOf = (id) => id.endsWith('_cop') ? id.replace(/_cop$/, '_ar') : id.endsWith('_ar') ? id.replace(/_ar$/, '_cop') : null;

// عدد القداسات حسب يوم الأسبوع (0=الأحد ... 6=السبت). باكر وعشية في نفس أيام القداس
const LITURGIES_BY_DAY = { 0: 2, 3: 1, 5: 2, 6: 1 };

// هل الخدمة موجودة في اليوم ده؟ (يوم الأسبوع، أو عيد/صوم من الـ API، أو تفعيل يدوي/انتقال من البحث)
function isOn(date, id, extras, auto) {
  const n = LITURGIES_BY_DAY[date.getDay()] || 0;
  const byWeek = id === 'liturgy' ? n >= 1 : id === 'liturgy2' ? n >= 2 : n > 0;
  const byAuto = !!auto && id !== 'liturgy2';
  return byWeek || byAuto || extras.has(isoKey(date) + '|' + id);
}
const liturgyCount = (date, extras, auto) => isOn(date, 'liturgy2', extras, auto) ? 2 : isOn(date, 'liturgy', extras, auto) ? 1 : 0;
const titleFor = (id, count) => id === 'liturgy'
  ? (count === 2 ? 'القداس الإلهي الأول' : 'القداس الإلهي')
  : ((ALL_SERVICES.find((s) => s.id === id) || {}).title || '');

// تاريخ بصيغة YYYY-MM-DD (بأصفار) للتعامل مع الـ API
function isoKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
// من صيغة قاعدة البيانات (2026-11-08) لمفتاح التطبيق (2026-11-8)
const fromIso = (s) => { const [y, m, d] = s.split('-'); return y + '-' + (+m) + '-' + (+d); };
const dateFromIso = (s) => { const [y, m, d] = s.split('-'); return new Date(+y, +m - 1, +d); };
const asList = (v) => Array.isArray(v) ? v : (v ? [v] : []);

// تأخير تنفيذ البحث لحد ما المستخدم يوقف كتابة لحظة (عشان ما نبعتش طلب مع كل حرف)
function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

// ===== الأعياد من الـ API =====
const AR_NAMES = [
  [/cross/, 'عيد الصليب'], [/nativity|christmas/, 'عيد الميلاد'], [/theophany|epiphany/, 'عيد الغطاس'],
  [/annunciation/, 'عيد البشارة'], [/palm/, 'أحد الشعانين'], [/resurrection|easter/, 'عيد القيامة'],
  [/ascension/, 'عيد الصعود'], [/pentecost/, 'عيد العنصرة'], [/circumcision/, 'عيد الختان'],
  [/cana/, 'عرس قانا الجليل'], [/presentation|entry into (the )?temple/, 'دخول المسيح الهيكل'],
  [/flight to egypt|entry into egypt/, 'دخول المسيح أرض مصر'], [/transfiguration/, 'عيد التجلي'],
  [/covenant/, 'خميس العهد'], [/apostles/, 'عيد الرسل'], [/assumption|dormition/, 'عيد انتقال العذراء'],
  [/nineve/, 'صوم نينوى'], [/great lent/, 'الصوم الكبير'],
];
const hasArabic = (s) => /[\u0600-\u06FF]/.test(s);
const nameOfCeleb = (c) => typeof c === 'string' ? c : String((c && (c.nameAr || c.name_ar || c.arabicName || c.titleAr || c.name || c.title || c.en)) || '');
const labelOfCeleb = (c) => { const n = nameOfCeleb(c); if (!n || hasArabic(n)) return n; const hit = AR_NAMES.find(([re]) => re.test(n.toLowerCase())); return hit ? hit[1] : n; };
const isFeastCeleb = (c) => !!c && typeof c === 'object' && /feast|major|lord|solemn|عيد/i.test(String(c.type || c.category || c.rank || c.kind || c.level || ''));

const OTHER_FASTS = [
  [/nativity fast|advent/, 'صوم الميلاد'],
  [/apostles/, 'صوم الرسل'],
  [/virgin/, 'صوم العذراء'],
];

// الموسم من /api/season/:date والمناسبات من /api/celebrations/:date
function getDynamicReadings(date, season = null, celebrations = []) {
  const sName = String((season && season.season) || '').toLowerCase();
  const isNineveh = /nineve|نينوى/.test(sName);
  const isGreatLent = /lent|الصوم الكبير/.test(sName);
  const isLentOrNineveh = isGreatLent || isNineveh;

  const feastItems = asList(celebrations).filter(isFeastCeleb);
  const feasts = [...new Set(feastItems.map(labelOfCeleb).filter(Boolean))];
  const isCrossFeast = feastItems.some((c) => /cross|صليب/i.test(nameOfCeleb(c)));

  const occasions = [];
  if (isNineveh) occasions.push('صوم نينوى');
  if (isGreatLent) occasions.push('الصوم الكبير');
  OTHER_FASTS.forEach(([re, label]) => { if (re.test(sName) && !occasions.includes(label)) occasions.push(label); });
  feasts.forEach((f) => { if (!occasions.includes(f)) occasions.push(f); });

  // الخدمات تظهر تلقائياً في الصوم الكبير/نينوى وفي أيام الأعياد (حسب الـ API)
  const auto = isLentOrNineveh || feasts.length > 0;

  const liturgy = LITURGY_READINGS;
  const matins = [MATINS_PSALM, ...(isLentOrNineveh ? [MATINS_PROPHECIES] : []), ...MATINS_REST, ...(isCrossFeast ? CROSS_MATINS : [])];
  const vespers = [...(isLentOrNineveh ? [] : VESPERS_READINGS), ...(isCrossFeast ? [CROSS_VESPERS] : [])];

  return { vespers, matins, liturgy, occasions, auto };
}
const fmt = (n) => n.toLocaleString('ar-EG');

const SOFT = 'var(--shadow)';
const SHADOW_SM = '0 1px 2px rgba(15,23,42,.06), 0 1px 3px rgba(15,23,42,.08)';
const Ic = (d, s = 18) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d=${d} /></svg>`;
const IC_BACK = 'M5 12h14m-7-7 7 7-7 7';   // سهم لليمين = رجوع في الواجهة العربية

// ===== مقاسات موحّدة للكروت =====
const CARD_PAD = 1.5;
const CARD_BASE = { borderColor: 'var(--line)', bgcolor: 'var(--card)', borderRadius: 3, boxShadow: SOFT };
const LIST_CARD = { ...CARD_BASE, p: CARD_PAD, minHeight: 64, display: 'flex', alignItems: 'center', gap: 1.25 };
const STAT_TILE = { textAlign: 'center', py: 1.5, px: 1, minHeight: 84, display: 'flex', flexDirection: 'column', justifyContent: 'center', borderRadius: 2 };

function SvcIcon({ id, size = 36 }) {
  const p = { fill: 'none', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const B = { ...p, style: { stroke: BLUE } }, G = { ...p, style: { stroke: GOLD } };
  const shapes = id === 'liturgy'
    ? html`<g><path ...${G} d="M24 2v10M19.5 6.5h9"/><path ...${B} d="M13 15h22c0 9-4.5 15-11 15s-11-6-11-15z"/><path ...${B} d="M24 30v9M16 42h16"/></g>`
    : id === 'matins'
    ? html`<g><path ...${B} d="M14 33a10 10 0 0 1 20 0"/><path ...${B} d="M6 37h36M16 43h16"/><path ...${G} d="M24 11v6M11 19l4 4M37 19l-4 4M5 32h4M39 32h4"/></g>`
    : html`<g><path d="M24 5c4.5 5.5 5.5 9 0 13-5.5-4-4.5-7.5 0-13z" style=${{ fill: GOLD, stroke: GOLD }} strokeWidth="1.5" strokeLinejoin="round"/><path ...${B} d="M24 18v4"/><rect x="18" y="22" width="12" height="18" rx="2" ...${B}/><path ...${B} d="M12 43h24"/></g>`;
  return html`<svg width=${size} height=${size} viewBox="0 0 48 48" aria-hidden="true">${shapes}</svg>`;
}

const COPT_M=['توت','بابه','هاتور','كيهك','طوبه','أمشير','برمهات','برمودة','بشنس','بؤونة','أبيب','مسرى','النسيء'];
const ysC=(y)=>365*(y-1)+Math.floor(y/4);
function cop(d){const days=Math.floor(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/864e5)+2440588-1825030;let y=Math.floor(days/365.25)+1;while(days<ysC(y))y--;while(days>=ysC(y+1))y++;const o=days-ysC(y);return{d:o%30+1,m:COPT_M[Math.floor(o/30)],y};}
const dKey=(d)=>d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();
const gFull=(d)=>new Intl.DateTimeFormat('ar-EG-u-ca-gregory',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(d);
const arDigits=(s)=>String(s).replace(/\d/g,(x)=>'٠١٢٣٤٥٦٧٨٩'[x]);
const copStr=(d)=>{const c=cop(d);return arDigits(c.d)+' '+c.m+' '+arDigits(c.y);};
const copShort=(d)=>{const c=cop(d);return arDigits(c.d)+' '+c.m;};

function CalendarDialog({ open, date, onPick, onClose }) {
  const [view, setView] = useState(new Date(date.getFullYear(), date.getMonth(), 1));
  React.useEffect(() => { if (open) setView(new Date(date.getFullYear(), date.getMonth(), 1)); }, [open]);
  const first = view.getDay(), tot = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const cells = [...Array(first).fill(0), ...Array.from({ length: tot }, (_, i) => i + 1)];
  const shift = (n) => setView(new Date(view.getFullYear(), view.getMonth() + n, 1));
  const title = new Intl.DateTimeFormat('ar-EG-u-ca-gregory', { month: 'long', year: 'numeric' }).format(view);
  const todayK = dKey(new Date());
  return html`
    <${Dialog} open=${open} onClose=${onClose} fullWidth maxWidth="xs">
      <${DialogTitle} sx=${{ color: BLUE, fontWeight: 700, fontFamily: "'Amiri',serif", fontSize: 26 }}>اختر اليوم<//>
      <${DialogContent}>
        <${Box} sx=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <${IconButton} onClick=${() => shift(-1)} aria-label="الشهر السابق" sx=${{ color: BLUE }}>›<//>
          <${Typography} sx=${{ fontWeight: 700, color: BLUE }}>${title}<//>
          <${IconButton} onClick=${() => shift(1)} aria-label="الشهر التالي" sx=${{ color: BLUE }}>‹<//>
        <//>
        <${Box} sx=${{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 0.5, textAlign: 'center' }}>
          ${['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'].map((n) => html`<${Typography} key=${n} sx=${{ fontSize: 12, color: 'var(--muted)', py: 0.5 }}>${n}<//>`)}
          ${cells.map((d, i) => {
            if (!d) return html`<span key=${i} />`;
            const dt = new Date(view.getFullYear(), view.getMonth(), d), sel = dKey(dt) === dKey(date), c = cop(dt);
            return html`<${Button} key=${i} onClick=${() => { onPick(dt); onClose(); }} sx=${{ minWidth: 0, p: 0.5, display: 'flex', flexDirection: 'column', lineHeight: 1.25, color: sel ? 'var(--seltx)' : 'var(--text)', bgcolor: sel ? BLUE : 'transparent', border: '1px solid ' + (dKey(dt) === todayK && !sel ? GOLD : 'transparent'), '&:hover': { bgcolor: sel ? BLUE : 'var(--soft2)' } }}>
              <span style=${{ fontWeight: 700, fontSize: 15 }}>${fmt(d)}</span>
              <span style=${{ fontSize: 10, opacity: 0.75 }}>${fmt(c.d)} ${c.m}</span>
            <//>`;
          })}
        <//>
      <//>
      <${DialogActions}>
        <${Button} onClick=${() => { onPick(new Date()); onClose(); }}>اليوم<//>
        <${Button} onClick=${onClose}>إغلاق<//>
      <//>
    <//>`;
}

// الهيدر: زر الرجوع الداخلي (سهم) في أول الشريط لما نكون في صفحة داخلية
function Header({ date, onCal, onSearch, mode, onToggle, onBack, pageTitle, user, onAuth }) {
  const btn = { bgcolor: 'var(--card)', color: 'var(--text)', border: '1px solid var(--btnline)', width: { xs: 36, sm: 40 }, height: { xs: 36, sm: 40 }, flexShrink: 0, '&:hover': { bgcolor: 'var(--hover)' } };
  const initial = user && user.email ? user.email.trim()[0].toUpperCase() : '';
  return html`
    <${AppBar} position="sticky" elevation=${0} sx=${{ bgcolor: 'var(--bg)', color: BLUE, borderBottom: '1px solid var(--hdrline)', paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <${Toolbar} sx=${{ gap: { xs: 0.75, sm: 2 }, flexWrap: 'nowrap', px: { xs: 1.25, sm: 3 }, minHeight: { xs: 56, sm: 64 }, py: { xs: 0.5, sm: 1.5 } }}>
        ${onBack && html`<${IconButton} onClick=${onBack} aria-label="رجوع" sx=${{ ...btn, color: BLUE, width: { xs: 40, sm: 44 }, height: { xs: 40, sm: 44 } }}>${Ic(IC_BACK, 22)}<//>`}
        <${Box} sx=${{ display: { xs: onBack ? 'none' : 'block', sm: 'block' }, flexShrink: 0, lineHeight: 0 }}>
          <img src=${logo} width="56" height="56" alt="شعار مدرسة البابا أثناسيوس الرسولي للألحان" style=${{ borderRadius: '50%' }} />
        <//>
        <${Box} sx=${{ flex: '1 1 auto', minWidth: 0 }}>
          <${Typography} noWrap sx=${{ fontFamily: "'Amiri',serif", fontWeight: 700, fontSize: { xs: 21, sm: 30 }, lineHeight: 1.3, color: BLUE }}>${pageTitle || 'آڤا أثناسيوس'}<//>
        <//>
        <${IconButton} onClick=${onToggle} aria-label=${mode === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'} sx=${btn}>${mode === 'dark' ? html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>` : html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`}<//>
        <${IconButton} onClick=${onSearch} aria-label="بحث" sx=${btn}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><//>
        <${IconButton} onClick=${onAuth} aria-label=${user ? 'الحساب' : 'تسجيل الدخول'} sx=${{ ...btn, ...(user ? { bgcolor: DARK_BLUE, color: '#fff', border: '2px solid ' + GOLD, fontWeight: 700, fontSize: 15, '&:hover': { bgcolor: DARK_BLUE_HOVER } } : {}) }}>
          ${user ? initial : html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`}
        <//>
        <${Button} variant="contained" onClick=${onCal} aria-label="تغيير اليوم من التقويم" sx=${{ bgcolor: 'var(--card)', color: 'var(--text)', border: '1px solid var(--btnline)', boxShadow: 'none', borderRadius: 999, px: { xs: 1.25, sm: 2 }, py: 0.75, gap: { xs: 0.75, sm: 1.25 }, flexShrink: 0, whiteSpace: 'nowrap', fontWeight: 700, fontSize: { xs: 12, sm: 14 }, '&:hover': { bgcolor: 'var(--hover)', boxShadow: 'none' } }}>
          <${Box} component="span" sx=${{ display: { xs: 'none', sm: 'inline' } }}>📅<//>
          <${Box} component="span" sx=${{ display: { xs: 'none', sm: 'inline' } }}>${copStr(date)}<//>
          <${Box} component="span" sx=${{ display: { xs: 'inline', sm: 'none' } }}>${copShort(date)}<//>
          <${Box} component="span" sx=${{ display: { xs: 'none', md: 'block' }, width: '1px', height: 20, bgcolor: 'var(--btnline)' }} />
          <${Box} component="span" sx=${{ display: { xs: 'none', md: 'inline' }, fontWeight: 600 }}>${gFull(date)} م<//>
        <//>
      <//>
    <//>`;
}

// ===== تسجيل الدخول والخروج (اختياري، التطبيق بيشتغل بدونه) =====
const authMsg = (m = '') =>
  /invalid login/i.test(m) ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة.'
  : /already (been )?registered/i.test(m) ? 'هذا البريد مسجّل بالفعل. يمكنك تسجيل الدخول.'
  : /password should be at least/i.test(m) ? 'كلمة المرور يجب ألا تقل عن ٦ أحرف.'
  : /email not confirmed/i.test(m) ? 'لم يتم تأكيد البريد بعد. افتح رسالة التأكيد المرسلة إلى بريدك.'
  : /invalid email|unable to validate email/i.test(m) ? 'صيغة البريد الإلكتروني غير صحيحة.'
  : /rate limit|too many|security purposes/i.test(m) ? 'محاولات كثيرة، حاول مرة أخرى بعد قليل.'
  : /network|fetch/i.test(m) ? 'تعذّر الاتصال، تحقّق من الإنترنت.'
  : 'تعذّر تنفيذ العملية. حاول مرة أخرى.';

function AuthDialog({ open, user, onClose, onToast }) {
  const [mode, setMode] = useState('in');           // in = دخول، up = حساب جديد، reset = استعادة كلمة المرور
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  useEffect(() => { if (open) { setErr(''); setInfo(''); setPw(''); setShow(false); } }, [open]);

  const switchTo = (m) => { setMode(m); setErr(''); setInfo(''); };

  const submit = async () => {
    setErr(''); setInfo('');
    const em = email.trim();
    if (!em) { setErr('أدخل البريد الإلكتروني.'); return; }
    if (mode !== 'reset' && !pw) { setErr('أدخل كلمة المرور.'); return; }
    if (mode === 'up' && pw.length < 6) { setErr('كلمة المرور يجب ألا تقل عن ٦ أحرف.'); return; }
    try {
      setBusy(true);
      if (mode === 'in') {
        await signIn(em, pw);
        onToast({ sev: 'success', msg: 'تم تسجيل الدخول' });
        onClose();
      } else if (mode === 'up') {
        const r = await signUp(em, pw);
        if (r && r.session) { onToast({ sev: 'success', msg: 'تم إنشاء الحساب' }); onClose(); }
        else { setInfo('تم إنشاء الحساب. أرسلنا رسالة تأكيد إلى بريدك، افتح الرابط ثم سجّل الدخول.'); setMode('in'); setPw(''); }
      } else {
        await resetPassword(em);
        setInfo('تم إرسال رابط استعادة كلمة المرور إلى بريدك الإلكتروني.');
      }
    } catch (e) {
      setErr(authMsg(e.message));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    try { setBusy(true); await signOut(); onToast({ sev: 'success', msg: 'تم تسجيل الخروج' }); onClose(); }
    catch (e) { setErr(authMsg(e.message)); }
    finally { setBusy(false); }
  };

  const seg = (id, label) => html`<${Button} key=${id} onClick=${() => switchTo(id)} sx=${{ flex: 1, height: 38, borderRadius: 2, fontWeight: 700, fontSize: 14, color: mode === id ? '#fff' : 'var(--text)', bgcolor: mode === id ? DARK_BLUE : 'transparent', '&:hover': { bgcolor: mode === id ? DARK_BLUE_HOVER : 'var(--soft2)' } }}>${label}<//>`;

  return html`
    <${Dialog} open=${open} onClose=${onClose} fullWidth maxWidth="xs" PaperProps=${{ sx: { borderRadius: 4 } }}>
      <${DialogTitle} sx=${{ pb: 0.5 }}>
        <${Typography} component="div" sx=${{ fontFamily: "'Amiri',serif", fontSize: 28, fontWeight: 700, color: BLUE, lineHeight: 1.3 }}>${user ? 'حسابي' : mode === 'reset' ? 'استعادة كلمة المرور' : 'مرحباً بك'}<//>
        ${!user && mode !== 'reset' && html`<${Typography} sx=${{ fontSize: 13.5, color: 'var(--muted)', mt: 0.25 }}>تسجيل الدخول اختياري، ويمكنك استخدام التطبيق بدونه.<//>`}
      <//>
      <${DialogContent} sx=${{ pt: 2 }}>
        ${user
          ? html`<${Box} sx=${{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <${Box} sx=${{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, borderRadius: 3, bgcolor: 'var(--soft)' }}>
                <${Box} sx=${{ width: 46, height: 46, borderRadius: '50%', bgcolor: DARK_BLUE, color: '#fff', border: '2px solid ' + GOLD, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 18, flexShrink: 0 }}>${(user.email || '?').trim()[0].toUpperCase()}<//>
                <${Box} sx=${{ minWidth: 0 }}>
                  <${Typography} sx=${{ fontSize: 12.5, color: 'var(--muted)' }}>البريد الإلكتروني<//>
                  <${Typography} noWrap sx=${{ fontWeight: 700, direction: 'ltr', textAlign: 'start' }}>${user.email}<//>
                <//>
              <//>
              ${err && html`<${Alert} severity="error" variant="outlined">${err}<//>`}
            <//>`
          : html`<${Box} sx=${{ display: 'flex', flexDirection: 'column', gap: 1.75 }}>
              ${mode !== 'reset' && html`<${Box} sx=${{ display: 'flex', gap: 0.5, p: 0.5, borderRadius: 3, bgcolor: 'var(--soft)' }}>${seg('in', 'تسجيل الدخول')}${seg('up', 'حساب جديد')}<//>`}
              ${mode === 'reset' && html`<${Typography} sx=${{ fontSize: 14, color: 'var(--muted)' }}>أدخل بريدك الإلكتروني وسنرسل لك رابطاً لإعادة تعيين كلمة المرور.<//>`}
              ${info && html`<${Alert} severity="success" variant="outlined">${info}<//>`}
              ${err && html`<${Alert} severity="error" variant="outlined">${err}<//>`}
              <${TextField} label="البريد الإلكتروني" type="email" size="small" fullWidth autoFocus value=${email} onChange=${(e) => setEmail(e.target.value)}
                onKeyDown=${(e) => { if (e.key === 'Enter') submit(); }} inputProps=${{ dir: 'ltr', style: { textAlign: 'start' } }} autoComplete="email" />
              ${mode !== 'reset' && html`<${TextField} label="كلمة المرور" type=${show ? 'text' : 'password'} size="small" fullWidth value=${pw} onChange=${(e) => setPw(e.target.value)}
                onKeyDown=${(e) => { if (e.key === 'Enter') submit(); }} inputProps=${{ dir: 'ltr', style: { textAlign: 'start' } }} autoComplete=${mode === 'in' ? 'current-password' : 'new-password'}
                helperText=${mode === 'up' ? '٦ أحرف على الأقل' : ''}
                InputProps=${{ endAdornment: html`<${InputAdornment} position="end"><${IconButton} size="small" onClick=${() => setShow(!show)} aria-label=${show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}>${show ? '🙈' : '👁'}<//><//>` }} />`}
              ${mode === 'in' && html`<${Button} size="small" onClick=${() => switchTo('reset')} sx=${{ alignSelf: 'flex-start', fontSize: 13 }}>نسيت كلمة المرور؟<//>`}
              ${mode === 'reset' && html`<${Button} size="small" onClick=${() => switchTo('in')} sx=${{ alignSelf: 'flex-start', fontSize: 13 }}>العودة لتسجيل الدخول<//>`}
            <//>`}
      <//>
      <${DialogActions} sx=${{ px: 3, pb: 2.5, gap: 1 }}>
        <${Button} onClick=${onClose} sx=${{ height: 42, px: 2.5 }}>إغلاق<//>
        ${user
          ? html`<${Button} variant="contained" disabled=${busy} onClick=${logout} sx=${{ height: 42, px: 3, borderRadius: 3 }}>${busy ? 'جارٍ الخروج...' : 'تسجيل الخروج'}<//>`
          : html`<${Button} variant="contained" disabled=${busy} onClick=${submit} sx=${{ height: 42, px: 3, borderRadius: 3 }}>${busy ? 'جارٍ التنفيذ...' : mode === 'in' ? 'دخول' : mode === 'up' ? 'إنشاء الحساب' : 'إرسال الرابط'}<//>`}
      <//>
    <//>`;
}

// الصفحة الرئيسية: كروت كبيرة، الكارد كله زر الانتقال
function Home({ items, onPick, title = 'اختر الخدمة', sub = 'اختر الصلاة لتوزيع القراء على قراءات اليوم.', occasions = [] }) {
  const n = Math.min(items.length, 3);
  return html`
    <${Box} sx=${{ width: '100%', maxWidth: n === 2 ? { md: 760 } : 1100, mx: 'auto', display: 'flex', flexDirection: 'column', minHeight: { xs: 'calc(100dvh - 104px)', md: 'auto' } }}>
      <${Typography} sx=${{ fontFamily: "'Amiri',serif", fontSize: { xs: 30, md: 44 }, fontWeight: 700, color: BLUE, lineHeight: 1.3 }}>${title}<//>
      <${Box} sx=${{ height: 4, width: { xs: 56, md: 90 }, bgcolor: GOLD, borderRadius: 2, my: 1 }} />
      <${Typography} sx=${{ color: 'var(--muted)', fontSize: { xs: 14.5, md: 18 }, mb: occasions.length ? 1.25 : { xs: 2, md: 4 } }}>${sub}<//>
      ${occasions.length > 0 && html`
        <${Box} sx=${{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: { xs: 2, md: 4 } }}>
          ${occasions.map((o) => html`<${Chip} key=${o} size="small" label=${o} sx=${{ height: 24, fontSize: 12.5, fontWeight: 700, color: BLUE, bgcolor: 'var(--soft)', border: '1px solid ' + GOLD }} />`)}
        <//>`}

      <${Box} sx=${{
        flex: { xs: 1, md: 'none' },
        display: 'grid',
        gap: { xs: 2, md: 3.5 },
        gridTemplateColumns: { xs: '1fr', md: 'repeat(' + n + ', minmax(0, 1fr))' },
        gridAutoRows: { xs: 'minmax(150px, 1fr)', md: 'auto' },
        maxHeight: { xs: 620, md: 'none' },
        pb: { xs: 0.5, md: 0 },
      }}>
        ${items.map((s) => html`
          <${Card} key=${s.id} variant="outlined" sx=${{ ...CARD_BASE, boxShadow: SHADOW_SM, borderRadius: { xs: 5, md: 6 }, borderBottom: '4px solid ' + GOLD_LINE, display: 'flex', height: '100%', transition: 'transform .2s, box-shadow .2s', '&:hover': { transform: 'translateY(-4px)', boxShadow: 'var(--shadow-h)' }, '&:active': { transform: 'scale(.99)' }, '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover, &:active': { transform: 'none' } } }}>
            <${CardActionArea} onClick=${() => onPick(s.id)} aria-label=${s.title} sx=${{
              width: '100%', height: '100%', minHeight: { xs: 150, md: 340 }, px: 3, py: { xs: 2, md: 4 },
              display: 'flex', flexDirection: { xs: 'row', md: 'column' }, alignItems: 'center', justifyContent: { xs: 'flex-start', md: 'center' },
              gap: 3, textAlign: { xs: 'start', md: 'center' },
            }}>
              <${Box} sx=${{ width: { xs: 88, md: 148 }, height: { xs: 88, md: 148 }, flex: '0 0 auto', '& svg': { width: { xs: 50, md: 84 }, height: { xs: 50, md: 84 } }, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'var(--soft)', border: '2.5px solid ' + GOLD }}><${SvcIcon} id=${s.base} size=${50} /><//>
              <${Typography} sx=${{ fontFamily: "'Amiri',serif", fontWeight: 700, fontSize: { xs: 30, md: 40 }, lineHeight: 1.3, color: BLUE }}>${s.title}<//>
            <//>
          <//>`)}
      <//>
    <//>`;
}

// يوم مفيهوش الخدمة دي
function EmptyDay({ svcId, onEnable }) {
  const msg = { liturgy: 'لا يوجد قداس إلهي اليوم', liturgy2: 'لا يوجد قداس ثانٍ اليوم', matins: 'لا توجد صلاة باكر اليوم', vespers: 'لا توجد صلاة عشية اليوم' }[svcId] || 'لا توجد قراءات اليوم';
  const what = { liturgy: 'القداس', liturgy2: 'القداس الثاني', matins: 'باكر', vespers: 'عشية' }[svcId];
  return html`
    <${Box} sx=${{ width: '100%', maxWidth: 1000, mx: 'auto' }}>
      <${Box} sx=${{ textAlign: 'center', py: { xs: 6, md: 10 }, px: 2, border: '1px solid var(--line)', borderRadius: 4, bgcolor: 'var(--card)', borderBottom: '3px solid ' + GOLD_LINE }}>
        <${Typography} sx=${{ fontFamily: "'Amiri',serif", fontSize: { xs: 26, md: 34 }, fontWeight: 700, color: BLUE }}>${msg}<//>
        <${Typography} sx=${{ mt: 1, mb: 3, color: 'var(--muted)', fontSize: 14 }}>لو في خدمة اليوم لمناسبة لم يتعرف عليها التطبيق، فعّليها يدوياً.<//>
        <${Button} variant="outlined" onClick=${onEnable} sx=${{ borderRadius: 3, height: 42, px: 3, borderColor: BLUE, color: BLUE }}>تفعيل ${what} لهذا اليوم<//>
      <//>
    <//>`;
}

// حقل قارئ واحد مع بحث تلقائي من Supabase (ilike، بحد أقصى 5 نتائج)
// clearOnSelect: بعد اختيار الاسم الحقل يفضل فاضي (للخانة العلوية في القراءات متعددة القرّاء)
function ReaderField({ value, onChange, placeholder = 'ابحث عن القارئ أو أضف اسم جديد...', clearOnSelect = false }) {
  const [input, setInput] = useState(typeof value === 'string' ? value : '');
  const [opts, setOpts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const q = useDebounced(input.trim(), 250);

  // لو القيمة اتغيّرت من برّه (حذف صف مثلاً) نزامن النص
  useEffect(() => { setInput(typeof value === 'string' ? value : ''); }, [value]);

  useEffect(() => {
    if (!q) { setOpts([]); setFailed(false); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    searchReaders(q, 5)
      .then((rows) => { if (alive) { setOpts(rows.map((r) => r.name)); setFailed(false); } })
      .catch((e) => { console.error(e); if (alive) { setOpts([]); setFailed(true); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [q]);

  const typed = input.trim();
  const options = typed && !opts.includes(typed) ? [...opts, { add: typed, label: 'إضافة "' + typed + '" كقارئ جديد' }] : opts;

  return html`<${Autocomplete} freeSolo autoSelect fullWidth size="small" options=${options}
    filterOptions=${(x) => x}
    inputValue=${input}
    onInputChange=${(e, v, reason) => { if (clearOnSelect && reason === 'reset') { setInput(''); return; } setInput(v); }}
    value=${clearOnSelect ? null : (value || null)}
    onChange=${(e, v) => { onChange(v ? (typeof v === 'string' ? v.trim() : v.add) : ''); if (clearOnSelect) setInput(''); }}
    getOptionLabel=${(o) => typeof o === 'string' ? o : o.add}
    renderOption=${(props, o) => html`<li ...${props} key=${typeof o === 'string' ? o : o.add} style=${typeof o === 'string' ? {} : { color: BLUE, fontWeight: 700 }}>${typeof o === 'string' ? o : '＋ ' + o.label}</li>`}
    renderInput=${(p) => html`<${TextField} ...${p}
      placeholder=${placeholder}
      error=${failed} helperText=${failed ? 'تعذّر البحث، تحقّق من الاتصال' : ''}
      InputProps=${{ ...p.InputProps, endAdornment: html`<${React.Fragment}>${loading ? html`<${CircularProgress} size=${16} />` : null}${p.InputProps.endAdornment}<//>` }}
      sx=${{ '& .MuiOutlinedInput-root': { minHeight: 48, borderRadius: 2 } }} />`} />`;
}

// كارد إحصائيات قارئ واحد: الاسم، الإجمالي، مربعات الخدمات، الملاحظات، وقائمة القراءات (آخر ٦ شهور)
function ReaderStats({ name, stats, notes, onNote }) {
  const [pick, setPick] = useState(null);
  const st = stats(name);
  const list = pick ? (pick === 'all' ? st.items : st.items.filter((i) => i.svc === pick)) : [];
  return html`
    <${Card} variant="outlined" sx=${{ ...CARD_BASE, boxShadow: SHADOW_SM, p: 2 }}>
      <${Box} sx=${{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.5 }}>
        <${Box} sx=${{ width: 40, height: 40, borderRadius: '50%', bgcolor: '#1E3A5F', color: '#fff', border: '2px solid ' + GOLD, display: 'grid', placeItems: 'center', fontWeight: 700, flexShrink: 0 }}>${name.trim()[0]}<//>
        <${Box} sx=${{ flex: 1, minWidth: 0 }}>
          <${Typography} noWrap sx=${{ fontWeight: 700, fontSize: 17 }}>${name}<//>
          <${Typography} sx=${{ fontSize: 12.5, color: 'var(--muted)' }}>قرأ ${fmt(st.total)} ${st.total > 2 && st.total < 11 ? 'مرات' : 'مرة'} خلال آخر ٦ شهور<//>
        <//>
        <${Button} size="small" variant="outlined" onClick=${() => onNote(name)} sx=${{ ...rowBtn, height: 34 }}>📝 ${notes[name] ? 'تعديل الملاحظة' : 'ملاحظة'}<//>
      <//>

      ${notes[name] && html`<${Typography} sx=${{ fontSize: 13.5, p: 1.25, mb: 1.5, borderRadius: 2, bgcolor: 'var(--soft)', whiteSpace: 'pre-wrap' }}>${notes[name]}<//>`}

      <${Box} sx=${{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1 }}>
        ${['عشية', 'باكر', 'القداس'].map((n) => html`
          <${CardActionArea} key=${n} onClick=${() => setPick(pick === n ? null : n)} aria-pressed=${pick === n} sx=${{ ...STAT_TILE, border: '1px solid ' + (pick === n ? BLUE : 'var(--line)'), bgcolor: pick === n ? 'var(--soft2)' : 'var(--card)' }}>
            <${Typography} sx=${{ fontSize: 26, fontWeight: 700, color: BLUE, lineHeight: 1.2 }}>${fmt(st[n])}<//>
            <${Typography} sx=${{ fontSize: 13 }}>${n}<//>
          <//>`)}
      <//>
      <${Button} size="small" onClick=${() => setPick(pick === 'all' ? null : 'all')} sx=${{ mt: 1 }}>${pick === 'all' ? 'إخفاء القائمة' : 'عرض كل القراءات'}<//>
      ${pick && html`
        <${Box} sx=${{ mt: 0.5, maxHeight: 240, overflow: 'auto' }}>
          ${list.length ? list.map((i, n) => html`
            <${Box} key=${n} sx=${{ py: 1, minHeight: 56, borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center' }}>
              <${Box} sx=${{ minWidth: 0 }}>
                <${Typography} sx=${{ fontWeight: 700, fontSize: 15 }}>${i.reading}<//>
                <${Typography} sx=${{ fontSize: 12, color: 'var(--muted)' }}>${gFull(i.date)} م - ${copStr(i.date)}<//>
              <//>
              <${Chip} size="small" label=${i.svc} variant="outlined" sx=${{ borderColor: GOLD, flexShrink: 0 }} />
            <//>`) : html`<${Typography} sx=${{ color: 'var(--muted)', py: 1 }}>لا توجد قراءات مسجلة<//>`}
        <//>`}
    <//>`;
}

// نافذة الإحصائيات والملاحظات: قارئ واحد أو أكتر (كل قارئ في كارد مستقل)
function StatsDialog({ names, stats, notes, onNote, onClose }) {
  const multi = names.length > 1;
  return html`
    <${Dialog} open=${names.length > 0} onClose=${onClose} fullWidth maxWidth=${multi ? 'sm' : 'xs'} scroll="paper">
      <${DialogTitle} sx=${{ color: BLUE, fontWeight: 700 }}>🔔 ${multi ? 'إحصائيات وملاحظات القرّاء (' + fmt(names.length) + ')' : 'إحصائيات وملاحظات القارئ'}<//>
      <${DialogContent} dividers=${multi}>
        <${Box} sx=${{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          ${names.map((n) => html`<${ReaderStats} key=${n} name=${n} stats=${stats} notes=${notes} onNote=${onNote} />`)}
        <//>
      <//>
      <${DialogActions}><${Button} onClick=${onClose}>إغلاق<//><//>
    <//>`;
}

// ملاحظات القارئ: الحفظ في Supabase عن طريق onSave (بترجع true لو نجح)
function NoteDialog({ name, notes, onSave, onClose }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  React.useEffect(() => { if (name) setDraft(notes[name] || ''); }, [name]);
  return html`
    <${Dialog} open=${!!name} onClose=${onClose} fullWidth maxWidth="sm">
      <${DialogTitle} sx=${{ color: BLUE, fontWeight: 700 }}>📝 ملاحظات عن القارئ: ${name}<//>
      <${DialogContent}>
        <${TextField} autoFocus multiline minRows=${4} fullWidth value=${draft} onChange=${(e) => setDraft(e.target.value)} placeholder="اكتب ملاحظاتك عن القارئ (مثال: مستواه، اللحن الأنسب له، أيام عدم التواجد)..." sx=${{ mt: 1 }} />
      <//>
      <${DialogActions}>
        <${Button} onClick=${onClose}>إلغاء<//>
        <${Button} variant="contained" disabled=${busy} onClick=${async () => { setBusy(true); const ok = await onSave(name, draft); setBusy(false); if (ok) onClose(); }}>${busy ? 'جارٍ الحفظ...' : 'حفظ الملاحظة'}<//>
      <//>
    <//>`;
}

const EMPTY_RES = { readers: [], readings: [], days: [], isDate: false };

// البحث الشامل: قرّاء + قراءات + أيام. الضغط على يوم/قراءة بيفتح اليوم بقراءاته وقرّائه
function SearchDialog({ open, stats, notes, rTitle, onClose, onStats, onNote, onGo }) {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [res, setRes] = useState(EMPTY_RES);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const dq = useDebounced(q.trim(), 300);

  useEffect(() => { setTerm(dq); }, [dq]);
  useEffect(() => { if (open) { setQ(''); setTerm(''); setRes(EMPTY_RES); setFailed(false); } }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!term) { setRes(EMPTY_RES); setFailed(false); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    searchAll(term)
      .then((r) => { if (alive) { setRes({ readers: r.readers || [], readings: r.readings || [], days: r.days || [], isDate: !!r.isDate }); setFailed(false); } })
      .catch((e) => { console.error(e); if (alive) { setRes(EMPTY_RES); setFailed(true); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [term, open]);

  // الأيام: من service_notes + (لو البحث بتاريخ) كل يوم/خدمة فيها تعيينات
  const dayList = useMemo(() => {
    const m = new Map();
    res.days.forEach((d) => m.set(d.service_date + '|' + d.service, { ...d }));
    if (res.isDate) res.readings.forEach((r) => {
      const kk = r.service_date + '|' + r.service;
      if (!m.has(kk)) m.set(kk, { service_date: r.service_date, service: r.service, note: '', occasion: '' });
      const it = m.get(kk); it.count = (it.count || 0) + 1;
    });
    return [...m.values()].sort((a, b) => (a.service_date < b.service_date ? 1 : a.service_date > b.service_date ? -1 : 0));
  }, [res]);

  const runNow = () => setTerm(q.trim());
  const svcTitle = (id) => (ALL_SERVICES.find((s) => s.id === id) || {}).title || id;
  const empty = term && !loading && !failed && !res.readers.length && !res.readings.length && !dayList.length;

  return html`
    <${Dialog} open=${open} onClose=${onClose} fullWidth maxWidth="sm">
      <${DialogTitle} sx=${{ color: BLUE, fontWeight: 700 }}>بحث شامل<//>
      <${DialogContent}>
        <${TextField} autoFocus fullWidth size="small" value=${q} onChange=${(e) => setQ(e.target.value)}
          onKeyDown=${(e) => { if (e.key === 'Enter') runNow(); }}
          placeholder="اسم قارئ، قراءة، عيد، أو تاريخ (مثال: 2026-11-08)" sx=${{ mt: 1 }}
          InputProps=${{ endAdornment: html`<${InputAdornment} position="end">
            ${loading ? html`<${CircularProgress} size=${18} />` : null}
            <${IconButton} onClick=${runNow} aria-label="بحث" edge="end" sx=${{ color: BLUE }}>${Ic('M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.35-4.35', 20)}<//>
          <//>` }} />

        ${failed && html`<${Alert} severity="error" variant="outlined" sx=${{ mt: 2 }}>تعذّر تنفيذ البحث، تحقّق من الاتصال وحاول مرة أخرى.<//>`}
        ${!term && html`<${Typography} sx=${{ mt: 2, color: 'var(--muted)', textAlign: 'center', fontSize: 14 }}>اكتب اسم قارئ أو قراءة أو عيد، أو تاريخاً بصيغة 2026-11-08 أو 2026-11 أو 2026.<//>`}
        ${empty && html`<${Typography} sx=${{ mt: 2, color: 'var(--muted)', textAlign: 'center' }}>لا توجد نتائج لـ "${term}"<//>`}

        ${dayList.length > 0 && html`
          <${Box} sx=${{ mt: 2 }}>
            <${Typography} sx=${{ fontWeight: 700, color: BLUE, mb: 0.25 }}>الأيام والمناسبات<//>
            <${Typography} sx=${{ fontSize: 12, color: 'var(--muted)', mb: 0.75 }}>اضغط على اليوم لفتحه بقراءاته وقرّائه<//>
            <${Box} sx=${{ display: 'grid', gap: 1, maxHeight: 300, overflow: 'auto' }}>
              ${dayList.map((d) => {
                const dt = dateFromIso(d.service_date);
                return html`
                  <${Card} key=${d.service_date + '|' + d.service} variant="outlined" sx=${{ ...CARD_BASE, minHeight: 72 }}>
                    <${CardActionArea} onClick=${() => onGo(d.service_date, d.service)} sx=${{ p: CARD_PAD }}>
                      <${Box} sx=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
                        <${Typography} sx=${{ fontWeight: 700, fontSize: 14.5 }}>${gFull(dt)} م - ${copStr(dt)}<//>
                        <${Chip} size="small" label=${svcTitle(d.service)} variant="outlined" sx=${{ borderColor: GOLD, flexShrink: 0 }} />
                      <//>
                      <${Box} sx=${{ mt: 0.75, display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
                        ${d.occasion && html`<${Chip} size="small" label=${d.occasion} sx=${{ height: 22, fontSize: 12, fontWeight: 700, color: BLUE, bgcolor: 'var(--soft)', border: '1px solid ' + GOLD }} />`}
                        ${d.count ? html`<${Typography} sx=${{ fontSize: 12.5, color: 'var(--muted)' }}>${fmt(d.count)} تعيين<//>` : null}
                      <//>
                      ${d.note && html`<${Typography} sx=${{ mt: 0.75, fontSize: 13, color: 'var(--muted)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'pre-wrap' }}>${d.note}<//>`}
                    <//>
                  <//>`;
              })}
            <//>
          <//>`}

        ${res.readers.length > 0 && html`
          <${Box} sx=${{ mt: 2 }}>
            <${Typography} sx=${{ fontWeight: 700, color: BLUE, mb: 0.75 }}>القرّاء<//>
            <${Box} sx=${{ display: 'grid', gap: 1 }}>
              ${res.readers.map((r) => html`
                <${Card} key=${r.id} variant="outlined" sx=${LIST_CARD}>
                  <${Box} sx=${{ width: 36, height: 36, borderRadius: '50%', bgcolor: '#1E3A5F', color: '#fff', border: '2px solid ' + GOLD, display: 'grid', placeItems: 'center', fontWeight: 700, flexShrink: 0 }}>${r.name[0]}<//>
                  <${Box} sx=${{ flex: 1, minWidth: 0 }}>
                    <${Typography} sx=${{ fontWeight: 700 }} noWrap>${r.name}<//>
                    <${Typography} sx=${{ fontSize: 12, color: 'var(--muted)' }}>قرأ ${fmt(stats(r.name).total)} مرة (آخر ٦ شهور)<//>
                  <//>
                  <${Button} size="small" onClick=${() => onStats([r.name])}>🔔 الإحصائيات والملاحظات<//>
                <//>`)}
            <//>
          <//>`}

        ${res.readings.length > 0 && html`
          <${Box} sx=${{ mt: 2.5 }}>
            <${Typography} sx=${{ fontWeight: 700, color: BLUE, mb: 0.75 }}>القراءات<//>
            <${Box} sx=${{ display: 'grid', gap: 1, maxHeight: 340, overflow: 'auto' }}>
              ${res.readings.map((r) => {
                const d = dateFromIso(r.service_date);
                return html`
                  <${Card} key=${r.service_date + '|' + r.service + '|' + r.reading_id + '|' + r.readers.name} variant="outlined" sx=${{ ...CARD_BASE, minHeight: 84 }}>
                    <${CardActionArea} onClick=${() => onGo(r.service_date, r.service)} sx=${{ p: CARD_PAD }}>
                      <${Box} sx=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
                        <${Typography} sx=${{ fontFamily: "'Amiri',serif", fontWeight: 700, fontSize: 20, color: BLUE }}>${r.reading_title || rTitle(r.reading_id)}<//>
                        <${Chip} size="small" label=${svcTitle(r.service)} variant="outlined" sx=${{ borderColor: GOLD, flexShrink: 0 }} />
                      <//>
                      <${Typography} sx=${{ fontWeight: 600, fontSize: 14 }}>${r.readers.name}<//>
                      <${Typography} sx=${{ fontSize: 12, color: 'var(--muted)' }}>${gFull(d)} م - ${copStr(d)}<//>
                    <//>
                  <//>`;
              })}
            <//>
          <//>`}
      <//>
      <${DialogActions}><${Button} onClick=${onClose}>إغلاق<//><//>
    <//>`;
}

// زرّا الحفظ ونسخ الجدول: نفس الحجم بالظبط
const barBtn = { height: 40, width: 124, minWidth: 124, px: 0, borderRadius: 3, fontSize: 14, whiteSpace: 'nowrap', boxShadow: 'none' };
const rowBtn = { height: 40, minWidth: 40, px: { xs: 1.25, sm: 2 }, fontSize: 13.5, borderRadius: 3, borderColor: 'var(--line)', bgcolor: 'var(--card)', color: 'var(--text)', gap: 0.75, whiteSpace: 'nowrap' };

function Service({ svc, date, dk, assign, onCommit, notes, svcNote, setSvcNote, onStats, titleOf, rTitle, dirtyRef, season = null, celebrations = [], loadingAPI = false }) {
  const [drawer, setDrawer] = useState(false);
  const [sDraft, setSDraft] = useState('');
  const [draft, setDraft] = useState({});          // تعديلات لم تُحفظ بعد
  const [editing, setEditing] = useState({});      // القراءات اللي بنعدّل أسماءها (زر تعديل)
  const [toast, setToast] = useState(null);        // { sev, msg }
  const [copied, setCopied] = useState(false);
  const [warn, setWarn] = useState(null);          // تنبيه تكرار الاسم (لا يمنع الإضافة)
  const [saving, setSaving] = useState(false);

  const map = getDynamicReadings(date, season, celebrations);
  const readingsOf = (sid) => map[(ALL_SERVICES.find((x) => x.id === sid) || {}).base || sid] || [];
  const currentReadings = loadingAPI ? [] : readingsOf(svc.id);
  const occasions = loadingAPI ? [] : map.occasions;
  const idSet = new Set(currentReadings.map((r) => r.id));
  const isPaired = (r) => { const p = partnerOf(r.id); return !!p && idSet.has(p); };

  const key = (r) => dk + '|' + svc.id + ':' + r.id;
  const sk = dk + '|' + svc.id;
  const eff = { ...assign, ...draft };
  const assigned = currentReadings.filter((r) => asList(eff[key(r)]).length > 0).length;
  const same = (a, b) => JSON.stringify(asList(a)) === JSON.stringify(asList(b));
  const dirty = Object.keys(draft).some((k) => !same(draft[k], assign[k]));

  // نبلّغ التطبيق بوجود تعديلات غير محفوظة (لزر الرجوع وللتنقل)
  useEffect(() => { dirtyRef.current = dirty; return () => { dirtyRef.current = false; }; }, [dirty]);

  const setReader = (k, rid, v) => {
    const prev = asList(eff[k]);
    const next = asList(v);
    const added = next.filter((x) => !prev.includes(x));
    let w = null;
    added.forEach((nm) => {
      if (w) return;
      const dup = Object.keys(eff).find((kk) => kk !== k && kk.split('|')[0] === dk && asList(eff[kk]).includes(nm));
      if (dup) {
        const ids = dup.split('|')[1].split(':');
        w = { k, msg: 'تنبيه: ' + nm + ' موجود بالفعل في قراءة ' + rTitle(ids[1]) + ' ضمن ' + titleOf(ids[0]) + ' في نفس اليوم.' };
      }
    });
    setWarn(w);
    setDraft({ ...draft, [k]: isMulti(rid) ? next : (next[0] || '') });
  };

  // قراءة متعددة القرّاء: إضافة اسم جديد (من الخانة العلوية) / تعديل أو حذف اسم موجود (من الخانات السفلية)
  const addName = (k, rid, v) => { if (v) setReader(k, rid, [...new Set([...asList(eff[k]), v])]); };
  const setAt = (k, rid, i, v) => {
    const arr = [...asList(eff[k])];
    if (v) arr[i] = v; else arr.splice(i, 1);
    setReader(k, rid, [...new Set(arr.filter(Boolean))]);
  };

  // زر واحد نظيف لعرض الإحصائيات والملاحظات (يظهر فوراً بعد اختيار الاسم)
  const infoBtn = (names) => html`<${Button} variant="outlined" onClick=${() => onStats(names)} sx=${{ ...rowBtn, alignSelf: 'flex-start' }}>🔔 الإحصائيات والملاحظات${names.length > 1 ? ' (' + fmt(names.length) + ')' : ''}<//>`;

  // الحفظ في Supabase: القراءات الفاضية بتتخطى (مفيش صف) ومش بتسبب خطأ
  const save = async () => {
    try {
      setSaving(true);
      const res = await saveAssignments({
        date, service: svc.id, occasions,
        readings: currentReadings.map((r) => ({ id: r.id, title: r.title, names: asList(eff[key(r)]), multi: r.multi })),
      });
      onCommit(draft); setDraft({}); setEditing({}); setWarn(null);

      const parts = [];
      if (res.updated) parts.push('تعديل ' + fmt(res.updated));
      if (res.inserted) parts.push('إضافة ' + fmt(res.inserted));
      if (res.deleted) parts.push('حذف ' + fmt(res.deleted));
      setToast({ sev: 'success', msg: parts.length ? 'تم الحفظ: ' + parts.join('، ') : 'تم الحفظ (لا توجد تغييرات)' });
    } catch (e) {
      console.error(e);
      setToast({ sev: 'error', msg: 'تعذّر الحفظ: ' + e.message });
    } finally {
      setSaving(false);
    }
  };

  // حفظ ملاحظات الخدمة في Supabase
  const saveNotes = async () => {
    try {
      await saveServiceNotes({ date, service: svc.id, note: sDraft });
      setSvcNote({ ...svcNote, [sk]: sDraft });
      setDrawer(false);
      setToast({ sev: 'success', msg: 'تم حفظ ملاحظات الخدمة' });
    } catch (e) {
      console.error(e);
      setToast({ sev: 'error', msg: 'تعذّر حفظ الملاحظات: ' + e.message });
    }
  };

  // نسخ الجدول: القراءات الفاضية بتظهر "—"
  const copyTable = () => {
    const txt = svc.title + '\n' + gFull(date) + ' م (' + copStr(date) + ')\n' + currentReadings.map((r) => r.title + ': ' + (asList(eff[key(r)]).join('، ') || '—')).join('\n');
    try { navigator.clipboard.writeText(txt); } catch (e) {}
    setCopied(true); setTimeout(() => setCopied(false), 1600);
  };

  return html`
    <${Box} sx=${{ width: '100%', maxWidth: 1000, mx: 'auto' }}>
      <${Card} variant="outlined" sx=${{ ...CARD_BASE, boxShadow: SHADOW_SM, borderRadius: 4, borderBottom: '3px solid ' + GOLD_LINE, p: { xs: 2, sm: 2.5 }, mb: 2.5 }}>
        <${Box} sx=${{ display: 'flex', alignItems: 'center', gap: 1.75 }}>
          <${Box} sx=${{ width: 56, height: 56, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'var(--soft)', border: '2px solid ' + GOLD, flexShrink: 0 }}><${SvcIcon} id=${svc.base} size=${32} /><//>
          <${Box} sx=${{ minWidth: 0 }}>
            <${Typography} sx=${{ fontFamily: "'Amiri',serif", fontSize: { xs: 26, sm: 30 }, fontWeight: 700, color: BLUE, lineHeight: 1.25 }}>${svc.title}<//>
            <${Typography} sx=${{ fontSize: 12.5, color: 'var(--muted)' }}>${gFull(date)} م - ${copStr(date)}<//>
            ${occasions.length > 0 && html`
              <${Box} sx=${{ mt: 0.75, display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                ${occasions.map((o) => html`<${Chip} key=${o} size="small" label=${o} sx=${{ height: 22, fontSize: 12, fontWeight: 700, color: BLUE, bgcolor: 'var(--soft)', border: '1px solid ' + GOLD }} />`)}
              <//>`}
          <//>
        <//>
        ${(loadingAPI || currentReadings.length > 0) && html`
          <${Box} sx=${{ mt: 2 }}>
            <${Box} sx=${{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
              <${Typography} sx=${{ fontSize: 14, fontWeight: 600, color: BLUE }}>القراءات المعينة<//>
              <${Typography} sx=${{ fontSize: 14, fontWeight: 700, color: BLUE }}>${loadingAPI ? '...' : html`${fmt(assigned)} من ${fmt(currentReadings.length)}`}<//>
            <//>
            <${Box} sx=${{ height: 8, borderRadius: 4, bgcolor: 'var(--line)', overflow: 'hidden' }}><${Box} sx=${{ height: '100%', borderRadius: 4, width: (currentReadings.length ? (assigned / currentReadings.length) * 100 : 0) + '%', background: 'var(--progfill)', transition: 'width .3s' }} /><//>
          <//>`}
        <${Box} sx=${{ mt: 2, display: 'flex', gap: 1 }}>
          <${Button} onClick=${() => { setSDraft(svcNote[sk] || ''); setDrawer(true); }} sx=${{ flex: { xs: 1, sm: 'none' }, minWidth: 0, height: 40, px: { xs: 1, sm: 2.5 }, fontSize: 13.5, whiteSpace: 'nowrap', borderRadius: 3, gap: 0.75, fontWeight: 700, color: 'var(--gbtn-tx)', background: 'var(--gbtn-bg)', border: '1px solid var(--gbtn-bd)', boxShadow: 'var(--gbtn-sh)', '&:hover': { background: 'var(--gbtn-hv)' } }}>ملاحظات الخدمة 📋${svcNote[sk] ? ' •' : ''}<//>
        <//>
      <//>

      ${loadingAPI && html`
        <${Box} sx=${{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }} aria-busy="true" aria-label="جاري تحميل القراءات">
          ${[0, 1, 2, 3].map((i) => html`<${Skeleton} key=${i} variant="rounded" height=${150} sx=${{ borderRadius: 4 }} />`)}
        <//>`}

      ${!loadingAPI && currentReadings.length === 0 && html`
        <${Box} sx=${{ textAlign: 'center', py: 7, border: '1px solid var(--line)', borderRadius: 4, bgcolor: 'var(--card)' }}>
          <${Typography} sx=${{ fontFamily: "'Amiri',serif", fontSize: 28, fontWeight: 700, color: BLUE }}>لا توجد قراءات اليوم<//>
        <//>`}

      <${Box} sx=${{ display: 'grid', gap: { xs: 2, md: 2.5 }, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, alignItems: 'stretch' }}>
        ${currentReadings.map((r) => {
          const k = key(r), list = asList(eff[k]), has = list.length > 0;
          const savedHas = asList(assign[k]).length > 0, isEd = !!editing[k];
          const showField = !savedHas || isEd, multi = r.multi, lang = langOf(r.id);
          const paired = isPaired(r);
          return html`
            <${Card} key=${r.id} variant="outlined" sx=${{
              ...CARD_BASE, boxShadow: SHADOW_SM, borderRadius: 4, p: { xs: 2, sm: 2.5 },
              display: 'flex', flexDirection: 'column', gap: 1.5,
              gridColumn: { xs: 'auto', md: paired ? 'auto' : '1 / -1' },
              borderTop: '3px solid ' + (has ? GOLD : 'transparent'),
            }}>
              <${Box} sx=${{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                <${Typography} noWrap sx=${{ flex: 1, minWidth: 0, fontFamily: "'Amiri',serif", fontWeight: 700, fontSize: { xs: 22, sm: 25 }, color: BLUE, lineHeight: 1.3 }}>${baseTitle(r.title)}<//>
                ${lang && html`<${Chip} size="small" label=${lang} sx=${{ height: 24, fontSize: 12, fontWeight: 700, flexShrink: 0, color: lang === 'قبطي' ? '#7a5b00' : BLUE, bgcolor: lang === 'قبطي' ? 'rgba(212,175,55,.18)' : 'var(--soft)', border: '1px solid ' + (lang === 'قبطي' ? GOLD : 'var(--line)') }} />`}
                <${Box} aria-hidden="true" sx=${{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, bgcolor: has ? GOLD : 'var(--line)' }} />
              <//>
              <${Typography} sx=${{ fontSize: 12, color: 'var(--muted)', mt: -0.75 }}>${multi ? 'يمكن إضافة أكثر من قارئ' : 'قارئ واحد فقط'}<//>

              ${showField
                ? html`<${React.Fragment}>
                  ${multi
                    ? html`<${Box} sx=${{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <${ReaderField} key=${k + '-new'} value=${null} clearOnSelect placeholder=${has ? 'أضف قارئاً آخر...' : 'ابحث عن قارئ أو اكتب اسماً جديداً...'} onChange=${(v) => addName(k, r.id, v)} />
                        ${list.map((nm, i) => html`<${ReaderField} key=${k + '-' + i + '-' + nm} value=${nm} placeholder="" onChange=${(v) => setAt(k, r.id, i, v)} />`)}
                      <//>`
                    : html`<${ReaderField} value=${eff[k] || null} onChange=${(v) => setReader(k, r.id, v)} />`}
                  <${Box} sx=${{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    ${has && infoBtn(list)}
                    ${savedHas && html`<${Button} size="small" onClick=${() => { const d = { ...draft }; delete d[k]; setDraft(d); setEditing({ ...editing, [k]: false }); setWarn(null); }} sx=${{ height: 40 }}>إلغاء التعديل<//>`}
                  <//>
                <//>`
                : html`<${React.Fragment}>
                  <${Box} sx=${{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    ${list.map((nm) => html`
                      <${Box} key=${nm} sx=${{ display: 'flex', alignItems: 'center', gap: 1.25, p: 1, borderRadius: 3, bgcolor: 'var(--soft)', minWidth: 0 }}>
                        <${Box} sx=${{ width: 34, height: 34, flexShrink: 0, borderRadius: '50%', bgcolor: '#1E3A5F', color: '#fff', border: '2px solid ' + GOLD_LINE, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 14 }}>${nm.trim()[0]}<//>
                        <${Typography} noWrap sx=${{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 15.5 }}>${nm}<//>
                      <//>`)}
                  <//>
                  <${Box} sx=${{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <${Button} variant="outlined" onClick=${() => setEditing({ ...editing, [k]: true })} sx=${{ height: 40, px: 2.5, borderRadius: 3, borderColor: BLUE, color: BLUE }}>تعديل<//>
                    ${infoBtn(list)}
                  <//>
                <//>`}

              ${warn && warn.k === k ? html`<${Alert} severity="warning" variant="outlined" onClose=${() => setWarn(null)} sx=${{ alignItems: 'center', fontSize: 13.5, bgcolor: 'var(--card)' }}>${warn.msg}<//>` : null}
            <//>`;
        })}
      <//>

      ${!loadingAPI && currentReadings.length > 0 && html`
        <${Box} sx=${{ position: 'sticky', bottom: 0, zIndex: 5, mt: 3, pt: 1.25, pb: 'calc(12px + env(safe-area-inset-bottom, 0px))', bgcolor: 'var(--bg)', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
          <${Button} variant="contained" disabled=${saving} onClick=${save} sx=${{ ...barBtn, bgcolor: DARK_BLUE, color: '#fff', fontWeight: 700, '&:hover': { bgcolor: DARK_BLUE_HOVER }, '&.Mui-disabled': { bgcolor: DARK_BLUE, color: '#fff', opacity: 0.6 } }}>${saving ? 'جارٍ الحفظ...' : 'حفظ'}<//>
          <${Button} variant="contained" onClick=${copyTable} sx=${{ ...barBtn, bgcolor: 'var(--soft2)', color: BLUE, border: '1px solid var(--line)', '&:hover': { bgcolor: 'var(--soft2)', filter: 'brightness(.96)' } }}>${copied ? 'تم النسخ ✓' : 'نسخ الجدول'}<//>
        <//>`}

      <${Snackbar} open=${!!toast} autoHideDuration=${3200} onClose=${() => setToast(null)} anchorOrigin=${{ vertical: 'bottom', horizontal: 'center' }} sx=${{ '&.MuiSnackbar-root': { bottom: 84 } }}>
        <${Alert} severity=${(toast && toast.sev) || 'success'} variant="filled" sx=${{ width: '100%' }}>${toast && toast.msg}<//>
      <//>

      <${Drawer} anchor=${window.innerWidth <= 600 ? 'bottom' : 'left'} open=${drawer} onClose=${() => setDrawer(false)} PaperProps=${{ sx: { width: { xs: '100%', sm: 400 }, p: 3, maxHeight: { xs: '88vh', sm: '100%' }, borderRadius: { xs: '20px 20px 0 0', sm: 0 } } }}>
        <${Typography} sx=${{ fontFamily: "'Amiri',serif", fontSize: 26, fontWeight: 700, color: BLUE }}>ملاحظات ${svc.title}<//>
        <${Box} sx=${{ height: 3, width: 60, bgcolor: GOLD, my: 1.5 }} />
        <${TextField} multiline minRows=${10} fullWidth value=${sDraft} onChange=${(e) => setSDraft(e.target.value)} placeholder="ملاحظات عامة للخدمة: الترتيب، التنبيهات، الألحان المطلوبة..." />
        <${Box} sx=${{ display: 'flex', gap: 1, mt: 2 }}>
          <${Button} variant="contained" onClick=${saveNotes}>تحديث الملاحظات<//>
          <${Button} onClick=${() => setDrawer(false)}>إغلاق<//>
        <//>
      <//>
    <//>`;
}

function App() {
  const [view, setView] = useState(null);          // null | 'liturgy_pick' | معرّف خدمة
  const [date, setDate] = useState(new Date());
  const [calOpen, setCalOpen] = useState(false);
  const [extras, setExtras] = useState(() => new Set());   // خدمات مفعّلة يدوياً أو بالانتقال من البحث
  const [appToast, setAppToast] = useState(null);
  const [user, setUser] = useState(null);          // المستخدم المسجّل (اختياري)
  const [authOpen, setAuthOpen] = useState(false);
  const dirtyRef = useRef(false);                  // في تعديلات غير محفوظة في صفحة القراءات؟
  const viewRef = useRef(null);                    // الصفحة الحالية (لاستعادتها لو المستخدم رفض مغادرة تعديلات غير محفوظة)
  const depthRef = useRef(0);                      // عمق التنقل داخل التطبيق
  const [mode, setMode] = useState(() => { try { const m = localStorage.getItem('mode'); if (m) return m; } catch (e) {} return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; });
  React.useEffect(() => { document.documentElement.setAttribute('data-theme', mode); try { localStorage.setItem('mode', mode); } catch (e) {} }, [mode]);
  const theme = useMemo(() => makeTheme(mode), [mode]);
  const dk = dKey(date);
  const [season, setSeason] = useState(null);
  const [celebrations, setCelebrations] = useState([]);
  const [loadingAPI, setLoadingAPI] = useState(true);

  useEffect(() => { viewRef.current = view; }, [view]);

  // تأكيد قبل ترك تعديلات غير محفوظة
  const okToLeave = () => !dirtyRef.current || window.confirm('عندك تعديلات لم تُحفظ. هل تريد الخروج بدون حفظ؟');

  // ===== التنقل داخل التطبيق: كل صفحة داخلية بتتسجّل في تاريخ المتصفح، فزر الرجوع (حتى زر الموبايل) بيرجّع للصفحة السابقة جوه التطبيق =====
  useEffect(() => {
    window.history.replaceState({ app: 1, v: null, d: 0 }, '');
    depthRef.current = 0;
    const onPop = (e) => {
      const st = e.state;
      if (!dirtyRef.current || window.confirm('عندك تعديلات لم تُحفظ. هل تريد الخروج بدون حفظ؟')) {
        dirtyRef.current = false;
        depthRef.current = (st && st.d) || 0;
        setView(st && st.app === 1 ? st.v : null);
      } else {
        window.history.pushState({ app: 1, v: viewRef.current, d: depthRef.current }, '');   // المستخدم رفض: نفضل في نفس الصفحة
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navTo = (next) => {
    depthRef.current += 1;
    window.history.pushState({ app: 1, v: next, d: depthRef.current }, '');
    setView(next);
  };
  const goBack = () => {
    if (!okToLeave()) return;
    dirtyRef.current = false;
    if (depthRef.current > 0) window.history.back();   // popstate هيحدّث الصفحة
    else setView(null);
  };

  // حالة تسجيل الدخول (بدون إجبار: التطبيق بيشتغل في الحالتين)
  useEffect(() => {
    getSession().then((s) => setUser(s ? s.user : null)).catch(() => {});
    return onAuth((s) => {
      setUser(s ? s.user : null);
      // بعد الرجوع من رابط التأكيد: ننضّف الرابط من رموز الدخول
      if (s && /access_token|type=signup|type=recovery/.test(window.location.hash)) {
        window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
      }
    });
  }, []);

  // جلب الموسم والمناسبات من الـ API. الـ loading بيخلص لما الاتنين يخلصوا (نجاح أو فشل)
  useEffect(() => {
    let alive = true;
    const iso = isoKey(date);
    setLoadingAPI(true); setSeason(null); setCelebrations([]);
    Promise.allSettled([
      axios.get(`https://api.coptic.io/api/season/${iso}`, { timeout: 8000 }),
      axios.get(`https://api.coptic.io/api/celebrations/${iso}`, { timeout: 8000 }),
    ]).then(([s, c]) => {
      if (!alive) return;
      if (s.status === 'fulfilled') { console.log('season:', iso, s.value.data); setSeason(s.value.data); }
      else console.error('خطأ في جلب الموسم:', s.reason);
      if (c.status === 'fulfilled') {
        console.log('celebrations:', iso, c.value.data);
        const d = c.value.data;
        setCelebrations(Array.isArray(d) ? d : Array.isArray(d && d.celebrations) ? d.celebrations : d && typeof d === 'object' ? [d] : []);
      } else console.error('خطأ في جلب المناسبات:', c.reason);
      setLoadingAPI(false);
    });
    return () => { alive = false; };
  }, [dk]);

  // التعيينات: { 'تاريخ|خدمة:قراءة': 'اسم' أو ['اسم','اسم'] للقراءات متعددة القرّاء }
  const [assign, setAssign] = useState({});
  const [notes, setNotes] = useState({});        // ملاحظات القرّاء { اسم: نص }
  const [svcNote, setSvcNote] = useState({});    // ملاحظات الخدمات { 'تاريخ|خدمة': نص }
  const [dbTitles, setDbTitles] = useState({});  // عناوين القراءات المحفوظة في القاعدة { reading_id: العنوان }

  // تحميل (أو إعادة تحميل) التعيينات والملاحظات من Supabase
  const loadData = async () => {
    try {
      const { readers, assignments, serviceNotes } = await loadAll();
      const rn = {}; readers.forEach((r) => { if (r.notes) rn[r.name] = r.notes; });
      setNotes(rn);

      const a = {}, t = {};
      assignments.forEach((row) => {
        if (row.reading_title) t[row.reading_id] = row.reading_title;
        const nm = row.readers && row.readers.name;
        if (!nm) return;
        const k = fromIso(row.service_date) + '|' + row.service + ':' + row.reading_id;
        a[k] = [...(a[k] || []), nm];
      });
      Object.keys(a).forEach((k) => { if (!isMulti(k.split(':')[1])) a[k] = a[k][0]; });
      setAssign(a);
      setDbTitles(t);

      const sn = {};
      serviceNotes.forEach((n) => { sn[fromIso(n.service_date) + '|' + n.service] = n.note; });
      setSvcNote(sn);
    } catch (e) {
      console.error(e);
      setAppToast({ sev: 'error', msg: 'تعذّر تحميل البيانات: ' + e.message });
    }
  };
  useEffect(() => { loadData(); }, []);

  // اسم القراءة بالعربي: من القاموس، وإلا من القاعدة، وإلا المعرّف نفسه
  const rTitle = (id) => staticTitle(id) || dbTitles[id] || id;

  // دمج التعديلات بعد نجاح الحفظ (الاسم الفاضي = إزالة التعيين)
  const commit = (changes) => setAssign((prev) => {
    const next = { ...prev };
    Object.entries(changes).forEach(([k, v]) => { if (asList(v).length) next[k] = v; else delete next[k]; });
    return next;
  });

  // حفظ ملاحظات قارئ في Supabase
  const saveNote = async (name, text) => {
    try {
      await saveReaderNote(name, text);
      setNotes((n) => ({ ...n, [name]: text }));
      setAppToast({ sev: 'success', msg: 'تم حفظ ملاحظات القارئ' });
      return true;
    } catch (e) {
      console.error(e);
      setAppToast({ sev: 'error', msg: 'تعذّر حفظ الملاحظة: ' + e.message });
      return false;
    }
  };

  const enable = (id) => setExtras((prev) => new Set(prev).add(isoKey(date) + '|' + id));

  // إحصائيات القارئ: آخر ٦ شهور بس (أسماء القراءات بالعربي)
  const stats = (name) => {
    const from = new Date();
    from.setMonth(from.getMonth() - 6);
    from.setHours(0, 0, 0, 0);

    const items = [];
    Object.keys(assign).forEach((k) => {
      if (!asList(assign[k]).includes(name)) return;
      const parts = k.split('|'), ids = parts[1].split(':'), d = parts[0].split('-');
      const dt = new Date(+d[0], +d[1] - 1, +d[2]);
      if (dt < from) return;
      items.push({
        svc: ALL_SERVICES.find(x => x.id === ids[0])?.stat || 'الخدمة',
        reading: rTitle(ids[1]),
        date: dt,
      });
    });
    items.sort((x, y) => y.date - x.date);
    const s = { items, total: items.length };
    ['عشية', 'باكر', 'القداس'].forEach((n) => { s[n] = items.filter((i) => i.svc === n).length; });
    return s;
  };
  const [statFor, setStatFor] = useState(null);
  const [noteFor, setNoteFor] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const info = useMemo(() => (loadingAPI ? { occasions: [], auto: false } : getDynamicReadings(date, season, celebrations)), [loadingAPI, date, season, celebrations]);
  const auto = info.auto;
  const lc = liturgyCount(date, extras, auto);
  const v = view === 'liturgy_pick' && lc !== 2 ? null : view;
  const titleOf = (id) => titleFor(id, lc);

  const onPickHome = (id) => { if (id === 'liturgy' && lc === 2) navTo('liturgy_pick'); else navTo(id); };
  const PICK_ITEMS = [
    { id: 'liturgy', base: 'liturgy', title: 'القداس الإلهي الأول' },
    { id: 'liturgy2', base: 'liturgy', title: 'القداس الإلهي الثاني' },
  ];

  // الانتقال ليوم وخدمة من نتيجة بحث: نفتح اليوم، نفعّل الخدمة، ونعيد تحميل التعيينات
  const goTo = (iso, service) => {
    if (!ALL_SERVICES.find((s) => s.id === service)) return;
    if (!okToLeave()) return;
    dirtyRef.current = false;
    setSearchOpen(false);
    setStatFor(null);
    setExtras((prev) => new Set(prev).add(iso + '|' + service));
    setDate(dateFromIso(iso));
    if (viewRef.current === null) navTo(service);
    else { window.history.replaceState({ app: 1, v: service, d: depthRef.current }, ''); setView(service); }
    loadData();
  };

  const pageTitle = v === 'liturgy_pick' ? 'القداس الإلهي' : v ? titleOf(v) : null;

  let page;
  if (v === 'liturgy_pick') {
    page = html`<${Home} items=${PICK_ITEMS} onPick=${navTo} title="القداس الإلهي" sub="اختر القداس لتوزيع القراء على قراءاته." />`;
  } else if (v) {
    const base = ALL_SERVICES.find((s) => s.id === v);
    const svc = { ...base, title: titleOf(v) };
    page = (isOn(date, v, extras, auto) || loadingAPI)
      ? html`<${Service} key=${dk + '|' + v} svc=${svc} date=${date} dk=${dk} season=${season} celebrations=${celebrations} loadingAPI=${loadingAPI} assign=${assign} onCommit=${commit} notes=${notes} svcNote=${svcNote} setSvcNote=${setSvcNote} onStats=${setStatFor} titleOf=${titleOf} rTitle=${rTitle} dirtyRef=${dirtyRef} />`
      : html`<${EmptyDay} svcId=${v} onEnable=${() => enable(v)} />`;
  } else {
    page = html`<${Home} items=${HOME_CARDS} onPick=${onPickHome} occasions=${info.occasions} />`;
  }

  return html`
    <${ThemeProvider} theme=${theme}>
      <${CssBaseline} />
      <${Header} mode=${mode} onToggle=${() => setMode(mode === 'dark' ? 'light' : 'dark')} date=${date} onCal=${() => setCalOpen(true)} onSearch=${() => setSearchOpen(true)} onBack=${v ? goBack : null} pageTitle=${pageTitle} user=${user} onAuth=${() => setAuthOpen(true)} />
      <${Container} maxWidth=${false} sx=${{ maxWidth: 1440, py: { xs: 2, sm: 4 }, px: { xs: 1.5, sm: 3 } }}>
        ${page}
      <//>
      <${SearchDialog} open=${searchOpen} stats=${stats} notes=${notes} rTitle=${rTitle} onClose=${() => setSearchOpen(false)} onStats=${setStatFor} onNote=${setNoteFor} onGo=${goTo} />
      <${StatsDialog} names=${asList(statFor)} stats=${stats} notes=${notes} onNote=${setNoteFor} onClose=${() => setStatFor(null)} />
      <${NoteDialog} name=${noteFor} notes=${notes} onSave=${saveNote} onClose=${() => setNoteFor(null)} />
      <${CalendarDialog} open=${calOpen} date=${date} onPick=${(d) => { if (okToLeave()) { dirtyRef.current = false; setDate(d); } }} onClose=${() => setCalOpen(false)} />
      <${AuthDialog} open=${authOpen} user=${user} onClose=${() => setAuthOpen(false)} onToast=${setAppToast} />
      <${Snackbar} open=${!!appToast} autoHideDuration=${3500} onClose=${() => setAppToast(null)} anchorOrigin=${{ vertical: 'bottom', horizontal: 'center' }}>
        <${Alert} severity=${(appToast && appToast.sev) || 'success'} variant="filled" sx=${{ width: '100%' }}>${appToast && appToast.msg}<//>
      <//>
    <//>`;
}
export default App;