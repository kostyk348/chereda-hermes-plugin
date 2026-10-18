/**
 * Череда в приложении Hermes.
 *
 * Петли обязательств вместо статусов: у каждой петли видно, **чей ход**, сколько
 * осталось до срока и чем дело доказано. Кнопки — это глаголы Череда, а не своя
 * логика: панель зовёт `/api/plugins/chereda/act`, бэкенд зовёт настоящий CLI
 * `череда`, и правила (не в свой ход не говорят, отказ только с причиной)
 * остаются в одном месте.
 *
 * Языки: ru и en. Ни одной строки в разметке — только через `t()`.
 */

import { host, usePluginI18n, useQuery } from '@hermes/plugin-sdk'
import { useState, useEffect } from 'react'
import { jsx } from 'react/jsx-runtime'

const ID = 'chereda'
const PATH = '/chereda'

const RU = {
  nav: 'Череда',
  name: 'Череда',
  palette: 'Череда: петли',
  verify: 'проверить реальность',
  loading: 'читаю петли…',
  summary: 'на ходу делающих: {performer} · на твоём ходу: {customer} · всего {total}',
  empty: 'открытых петель нет — нечего держать в голове',
  backendOff: 'Бэкенд Череда не подключён: {error}. Плагин включён, но шлюз должен перезапуститься, чтобы смонтировать /api/plugins/chereda.',
  turnCustomer: 'ход заказчика',
  turnPerformer: 'ход делающего',
  turnNone: 'закрыта',
  wordFor: 'слово за {who}',
  noTurn: 'хода нет',
  left: 'осталось {time} · до {when}',
  late: 'часы вышли {time} назад',
  level: 'уровень {n} — сигнал выше',
  sectionDescription: 'описание',
  sectionEvidence: 'доказательство',
  sectionHistory: 'ходы',
  sectionFeed: 'лента',
  sectionCard: 'карточка канбана',
  aboutEmpty: 'описания нет — напиши, что именно нужно и чем мерить',
  aboutSize: 'описание ({n} симв.)',
  aboutNone: 'описание (пусто)',
  expand: 'развернуть целиком',
  collapse: 'свернуть описание',
  editAbout: 'править описание',
  saveAbout: 'сохранить описание',
  cancel: 'отмена',
  noEvidence: 'доказательства нет — объявления не было',
  expected: 'ждали код {code} · отпечаток {digest}',
  output: 'вывод',
  moves: 'ходов: {n}',
  sayPlaceholder: 'сказать в ленту — отчёт, вопрос, заметка',
  say: 'сказать',
  showCardBody: 'показать описание карточки',
  cardNoBody: 'описания нет',
  noBody: '—',
  glossaryTitle: 'что значат глаголы',
  glossaryHint: 'раскрыть справку',
  executor: 'исполнитель {who}',
  noExecutor: 'без исполнителя',
  attempts: 'попыток {n}',
  reports: 'отчётов {n}',
  ask: 'просить',
  askHint: 'заказчик просит: дело одной фразой, ход переходит делающему',
  promise: 'обещать',
  promiseHint: 'делающий берёт дело и называет срок; больше трёх обещаний у одного не бывает',
  refuse: 'отказать',
  refuseHint: 'делающий отказывается и обязан назвать причину; ход возвращается заказчику',
  declare: 'сделать',
  declareHint: 'делающий объявляет сделанное и прикладывает доказательство — команду, которая проверяет результат',
  accept: 'принять',
  acceptHint: 'заказчик принимает: петля закрыта, остаётся след',
  object: 'возразить',
  objectHint: 'заказчик не принимает и говорит, что не так; ход снова у делающего',
  withdraw: 'снять',
  withdrawHint: 'заказчик снимает просьбу: петля закрыта',
  verifyHint: 'перепроверить доказательства; если не воспроизвелось — петля открыта снова',
  fieldFor: 'на сколько секунд',
  fieldReason: 'причина отказа (обязательно)',
  fieldObjection: 'причина возражения (обязательно)',
  fieldProof: 'команда-доказательство',
  needField: '{verb}: заполни «{field}» и нажми ещё раз',
  emptySay: 'пустое сообщение не отправить',
  emptyAbout: 'пустое описание не сохранить',
  failed: 'не вышло: {error}',
  verifyFailed: 'проверка не прошла: {error}',
  speakAs: 'пишу как',
  asCustomer: 'заказчик ({who})',
  asPerformer: 'делающий ({who})',
  filterAll: 'все',
  filterMine: 'на моём ходу',
  filterTheirs: 'на ходу делающих',
  filterLate: 'просрочено',
  noMatch: 'под этот фильтр ничего не подходит',
  toFeed: 'в ленту (Enter — отправить)'
}

const EN = {
  nav: 'Cherada',
  name: 'Cherada',
  palette: 'Cherada: loops',
  verify: 'check reality',
  loading: 'reading loops…',
  summary: 'on performers: {performer} · on your move: {customer} · total {total}',
  empty: 'no open loops — nothing to hold in your head',
  backendOff: 'The Cherada backend is not connected: {error}. The plugin is enabled, but the gateway must restart to mount /api/plugins/chereda.',
  turnCustomer: "customer's move",
  turnPerformer: "performer's move",
  turnNone: 'closed',
  wordFor: 'word with {who}',
  noTurn: 'no move',
  left: '{time} left · due {when}',
  late: 'clock ran out {time} ago',
  level: 'level {n} — escalated',
  sectionDescription: 'description',
  sectionEvidence: 'evidence',
  sectionHistory: 'moves',
  sectionFeed: 'feed',
  sectionCard: 'kanban card',
  aboutEmpty: 'no description yet — write what is needed and how to measure it',
  aboutSize: 'description ({n} chars)',
  aboutNone: 'description (empty)',
  expand: 'show in full',
  collapse: 'collapse description',
  editAbout: 'edit description',
  saveAbout: 'save description',
  cancel: 'cancel',
  noEvidence: 'no evidence — nothing was declared',
  expected: 'expected exit code {code} · digest {digest}',
  output: 'output',
  moves: 'moves: {n}',
  sayPlaceholder: 'say it in the feed — report, question, note',
  say: 'say',
  showCardBody: 'show the card description',
  cardNoBody: 'no description',
  noBody: '—',
  glossaryTitle: 'what the verbs mean',
  glossaryHint: 'open the glossary',
  executor: 'performer {who}',
  noExecutor: 'no performer',
  attempts: 'attempts {n}',
  reports: 'reports {n}',
  ask: 'ask',
  askHint: 'the customer asks: one sentence, and the move passes to the performer',
  promise: 'promise',
  promiseHint: 'the performer takes the work and names a term; no more than three promises at a time',
  refuse: 'refuse',
  refuseHint: 'the performer declines and must give a reason; the move returns to the customer',
  declare: 'declare',
  declareHint: 'the performer declares the work done and attaches evidence — a command that checks the result',
  accept: 'accept',
  acceptHint: 'the customer accepts: the loop closes and leaves a trace',
  object: 'object',
  objectHint: 'the customer does not accept and says what is wrong; the move is the performer’s again',
  withdraw: 'withdraw',
  withdrawHint: 'the customer withdraws the request: the loop closes',
  verifyHint: 're-run every proof; if it no longer reproduces, the loop reopens',
  fieldFor: 'for how many seconds',
  fieldReason: 'reason for declining (required)',
  fieldObjection: 'reason for objecting (required)',
  fieldProof: 'proof command',
  needField: '{verb}: fill in “{field}” and press again',
  emptySay: 'an empty message is not sent',
  emptyAbout: 'an empty description is not saved',
  failed: 'failed: {error}',
  verifyFailed: 'the check did not pass: {error}',
  speakAs: 'writing as',
  asCustomer: 'customer ({who})',
  asPerformer: 'performer ({who})',
  filterAll: 'all',
  filterMine: 'on my move',
  filterTheirs: 'on performers',
  filterLate: 'overdue',
  noMatch: 'nothing matches this filter',
  toFeed: 'to the feed (Enter sends)'
}

const LOCALES = { ru: RU, en: EN }

const STATE_KEY = { просит: 'ask', обещано: 'promise', объявлено: 'declare', возражение: 'object', отказ: 'refuse' }
const TURN_KEY = { customer: 'turnCustomer', performer: 'turnPerformer', none: 'turnNone' }
const VERB_KEY = {
  просить: 'ask',
  обещать: 'promise',
  отказать: 'refuse',
  сделать: 'declare',
  принять: 'accept',
  возразить: 'object',
  снять: 'withdraw'
}
const GLOSSARY = ['ask', 'promise', 'refuse', 'declare', 'accept', 'object', 'withdraw', 'verify']

const CSS = `
.hc-page{padding:18px 22px 40px;max-width:1040px;margin:0 auto;overflow-y:auto;overflow-x:hidden;height:100%;scrollbar-gutter:stable}
.hc-head{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:10px;
  position:sticky;top:0;z-index:3;background:var(--ui-bg,#12141a);padding:6px 0 8px}
.hc-bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:12px;
  position:sticky;top:38px;z-index:2;background:var(--ui-bg,#12141a);padding-bottom:6px}
.hc-sep{width:1px;height:18px;background:var(--ui-border,#2a2f3a);margin:0 4px}
.hc-chip{font:inherit;font-size:12px;color:var(--ui-text-tertiary,#8b93a7);background:transparent;
  border:1px solid var(--ui-border,#2a2f3a);border-radius:999px;padding:2px 10px;cursor:pointer}
.hc-chip:hover{color:inherit;border-color:var(--ui-accent,#3b82f6)}
.hc-chip-on{color:#fff;background:var(--ui-accent,#3b82f6);border-color:var(--ui-accent,#3b82f6)}
.hc-title{font-size:16px;font-weight:600;margin:0}
.hc-sub{color:var(--ui-text-tertiary,#8b93a7);font-size:12.5px}
.hc-btn{font:inherit;font-size:12.5px;color:inherit;background:var(--ui-surface,#1b1e26);
  border:1px solid var(--ui-border,#2a2f3a);border-radius:7px;padding:4px 10px;cursor:pointer}
.hc-btn:hover{border-color:var(--ui-accent,#3b82f6)}
.hc-btn[disabled]{opacity:.45;cursor:default}
.hc-loop{border:1px solid var(--ui-border,#2a2f3a);border-left:3px solid #8b5cf6;
  border-radius:9px;padding:10px 12px;margin-bottom:8px;background:var(--ui-surface,#1b1e26)}
.hc-loop[data-turn=customer]{border-left-color:#f59e0b}
.hc-loop[data-turn=performer]{border-left-color:#3b82f6}
.hc-loop[data-turn=none]{border-left-color:#22c55e;opacity:.75}
.hc-top{display:flex;gap:10px;align-items:flex-start;justify-content:space-between}
.hc-num{color:var(--ui-text-tertiary,#8b93a7);font-weight:600}
.hc-cause{font-weight:600;margin-bottom:4px}
.hc-meta{display:flex;gap:10px;flex-wrap:wrap;color:var(--ui-text-tertiary,#8b93a7);font-size:12px;margin-bottom:8px}
.hc-pill{border:1px solid var(--ui-border,#2a2f3a);border-radius:999px;padding:0 7px}
.hc-late{color:#f87171;font-weight:600}
.hc-esc{color:#fbbf24;border-color:#78350f}
.hc-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.hc-input{font:inherit;font-size:12.5px;background:var(--ui-bg,#12141a);color:inherit;
  border:1px solid var(--ui-border,#2a2f3a);border-radius:7px;padding:4px 8px;min-width:280px;flex:1}
.hc-hint{font-size:11.5px;color:var(--ui-text-tertiary,#8b93a7);margin-top:5px;font-style:italic}
.hc-note{font-size:12.5px;color:var(--ui-text-tertiary,#8b93a7);margin-top:6px;white-space:pre-wrap}
.hc-sec{margin-top:9px;border-top:1px dashed var(--ui-border,#2a2f3a);padding-top:7px}
.hc-sec-t{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ui-text-tertiary,#8b93a7);margin-bottom:4px}
.hc-desc{white-space:pre-wrap;font-size:12.5px;color:#cfd6e4;background:var(--ui-bg,#12141a);
  border:1px solid var(--ui-border,#2a2f3a);border-radius:7px;padding:8px 10px;max-height:220px;
  overflow-y:auto;scrollbar-gutter:stable}
.hc-desc-full{max-height:none}
.hc-edit{width:100%;min-height:150px;font:inherit;font-size:12.5px;resize:vertical}
.hc-ev{font-family:var(--font-mono,monospace);font-size:11.5px;color:#cfd6e4;background:var(--ui-bg,#12141a);
  border:1px solid var(--ui-border,#2a2f3a);border-radius:7px;padding:6px 8px;margin-top:6px;white-space:pre-wrap;
  word-break:break-word;max-height:200px;overflow-y:auto;scrollbar-gutter:stable}
.hc-act{display:flex;gap:8px;font-size:12px;padding:2px 0;border-bottom:1px solid rgba(255,255,255,.03)}
.hc-act-when{color:var(--ui-text-tertiary,#8b93a7);min-width:78px}
.hc-act-what{min-width:96px;color:#cfd6e4}
.hc-act-who{min-width:88px;color:#93c5fd}
.hc-act-note{color:var(--ui-text-tertiary,#8b93a7);flex:1;white-space:pre-wrap}
.hc-kv{font-size:12px;color:var(--ui-text-tertiary,#8b93a7);margin-bottom:5px}
.hc-cmt{background:rgba(59,130,246,.06);border-left:3px solid #33405a;border-radius:0 6px 6px 0;
  padding:5px 9px;margin:5px 0;font-size:12px;white-space:pre-wrap;color:#cfd6e4}
.hc-cmt-worker{border-left-color:#3b82f6;background:rgba(59,130,246,.10)}
.hc-cmt-who{color:var(--ui-text-tertiary,#8b93a7);font-size:11px;margin-bottom:3px}
.hc-empty{border:1px dashed var(--ui-border,#2a2f3a);border-radius:10px;padding:16px;color:var(--ui-text-tertiary,#8b93a7)}
.hc-warn{border:1px solid #7f1d1d;background:#2a1215;border-radius:9px;padding:12px 14px;margin-bottom:14px;color:#fecaca;font-size:12.5px}
.hc-gloss{border:1px solid var(--ui-border,#2a2f3a);border-radius:9px;padding:10px 12px;margin-bottom:12px;background:var(--ui-surface,#1b1e26)}
.hc-gloss-row{display:flex;gap:10px;font-size:12.5px;padding:2px 0}
.hc-gloss-verb{min-width:110px;color:#93c5fd;font-weight:600}
.hc-gloss-text{color:var(--ui-text-tertiary,#8b93a7);flex:1}
`

const fill = (text, vars) => String(text).replace(/\{(\w+)\}/g, (m, key) => (vars[key] ?? m))

function human(secs) {
  if (secs === null || secs === undefined) return '—'
  const v = Math.abs(secs)
  const text = v >= 86400 ? `${Math.floor(v / 86400)}d` : v >= 3600 ? `${Math.floor(v / 3600)}h` : v >= 60 ? `${Math.floor(v / 60)}m` : `${v}s`

  return secs < 0 ? `−${text}` : text
}

const when = (epoch) =>
  epoch ? new Date(epoch * 1000).toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

/** Какие ходы предлагать в этом состоянии петли. */
function actionsFor(loop) {
  const { turn, state } = loop

  if (turn === 'performer' && (state === 'просит' || state === 'возражение')) return ['обещать', 'отказать']
  if (turn === 'performer' && state === 'обещано') return ['сделать']
  if (turn === 'customer' && state === 'объявлено') return ['принять', 'возразить']
  if (turn === 'customer' && state === 'отказ') return ['снять']

  return []
}

/** Что глагол просит ввести. */
const NEEDS = {
  обещать: { field: 'for', key: 'fieldFor' },
  отказать: { field: 'reason', key: 'fieldReason' },
  сделать: { field: 'proof', key: 'fieldProof' },
  возразить: { field: 'reason', key: 'fieldObjection' },
  принять: null,
  снять: null
}

function Section({ title, children }) {
  return jsx('div', { className: 'hc-sec', children: [jsx('div', { className: 'hc-sec-t', children: title }), children] })
}

function Act({ act }) {
  return jsx('div', {
    className: 'hc-act',
    children: [
      jsx('span', { className: 'hc-act-when', children: when(act.at) }),
      jsx('span', { className: 'hc-act-what', children: act.act }),
      jsx('span', { className: 'hc-act-who', children: act.who }),
      act.note ? jsx('span', { className: 'hc-act-note', children: act.note }) : null
    ].filter(Boolean)
  })
}

function Glossary({ t, open, toggle }) {
  return jsx('div', {
    className: 'hc-gloss',
    children: [
      jsx('button', {
        className: 'hc-btn',
        onClick: toggle,
        children: open ? t('glossaryTitle') : `${t('glossaryTitle')} — ${t('glossaryHint')}`
      }),
      open
        ? jsx('div', {
            style: { marginTop: '8px' },
            children: GLOSSARY.map((key) =>
              jsx('div', {
                key,
                className: 'hc-gloss-row',
                children: [
                  jsx('span', { className: 'hc-gloss-verb', children: t(key) }),
                  jsx('span', { className: 'hc-gloss-text', children: t(`${key}Hint`) })
                ]
              })
            )
          })
        : null
    ]
  })
}

function Loop({ loop, onAct, busy, t, role }) {
  const [draft, setDraft] = useState({})
  const [fullAbout, setFullAbout] = useState(true)
  const [editAbout, setEditAbout] = useState(false)
  const [openCard, setOpenCard] = useState(false)
  const need = loop.inline ? NEEDS[loop.inline] : null
  const state = STATE_KEY[loop.state] ? t(STATE_KEY[loop.state]) : loop.state
  const late = loop.remaining <= 0
  const linked = loop.linked
  const available = actionsFor(loop)
  /** От чьего имени пишем: владелец — заказчик, ответ агента — делающий. */
  const speaker = role === 'performer' ? loop.performer : loop.customer

  const run = (verb) => {
    const params = { id: loop.id }

    if (verb === 'описать') {
      params.who = loop.customer
      params.text = draft.about ?? loop.about ?? ''
      onAct({ verb, params, loop })

      return
    }
    if (verb === 'сказать') {
      params.who = speaker
      params.text = draft.say || ''
      onAct({ verb, params, loop })

      return
    }
    const value = draft[verb]
    if (NEEDS[verb] && value) params[NEEDS[verb].field] = value
    params.who = loop.performer
    onAct({ verb, params, loop })
  }

  const about = jsx(Section, {
    title: loop.about ? fill(t('aboutSize'), { n: loop.about.length }) : t('aboutNone'),
    children: editAbout
      ? [
          jsx('textarea', {
            className: 'hc-desc hc-edit',
            value: draft.about ?? loop.about ?? '',
            onChange: (e) => setDraft({ ...draft, about: e.target.value })
          }),
          jsx('div', {
            className: 'hc-actions',
            children: [
              jsx('button', { className: 'hc-btn', disabled: busy, onClick: () => run('описать'), children: t('saveAbout') }),
              jsx('button', { className: 'hc-btn', disabled: busy, onClick: () => setEditAbout(false), children: t('cancel') })
            ]
          })
        ]
      : [
          jsx('div', { className: `hc-desc${fullAbout ? ' hc-desc-full' : ''}`, children: loop.about || t('aboutEmpty') }),
          jsx('div', {
            className: 'hc-actions',
            children: [
              jsx('button', { className: 'hc-btn', onClick: () => setFullAbout(!fullAbout), children: fullAbout ? t('collapse') : t('expand') }),
              jsx('button', { className: 'hc-btn', onClick: () => setEditAbout(true), children: t('editAbout') })
            ]
          })
        ]
  })

  const evidence = jsx(Section, {
    title: t('sectionEvidence'),
    children: loop.evidence
      ? jsx('div', {
          className: 'hc-ev',
          children: [
            `$ ${loop.evidence.command}`,
            loop.evidence.dir ? `  ${loop.evidence.dir}` : null,
            `  ${fill(t('expected'), { code: loop.evidence.expect, digest: loop.evidence.digest })}`,
            loop.evidence.excerpt ? `  ${t('output')}:\n  ${String(loop.evidence.excerpt).split('\n').slice(0, 6).join('\n  ')}` : null
          ]
            .filter(Boolean)
            .join('\n')
        })
      : jsx('div', { className: 'hc-kv', children: t('noEvidence') })
  })

  const history = loop.history && loop.history.length
    ? jsx(Section, {
        title: fill(t('moves'), { n: loop.history.length }),
        children: jsx('div', { children: loop.history.map((act, i) => jsx(Act, { key: i, act })) })
      })
    : null

  const feed = jsx(Section, {
    title: `${t('sectionFeed')}${loop.feed && loop.feed.length ? ` (${loop.feed.length})` : ''}`,
    children: [
      ...(loop.feed || []).map((msg, i) =>
        jsx('div', {
          key: `f${i}`,
          className: `hc-cmt${msg.who === loop.performer ? ' hc-cmt-worker' : ''}`,
          children: [jsx('div', { className: 'hc-cmt-who', children: `${msg.who} · ${when(msg.at)}` }), jsx('div', { children: msg.text })]
        })
      ),
      jsx('div', {
        className: 'hc-actions',
        children: [
          jsx('input', {
            className: 'hc-input',
            placeholder: `${t('sayPlaceholder')} · ${t('speakAs')} ${speaker}`,
            value: draft.say || '',
            onChange: (e) => setDraft({ ...draft, say: e.target.value }),
            onKeyDown: (e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                run('сказать')
              }
            }
          }),
          jsx('button', { className: 'hc-btn', disabled: busy, onClick: () => run('сказать'), children: t('say') })
        ]
      })
    ]
  })

  const card = linked
    ? jsx(Section, {
        title: `${t('sectionCard')} ${linked.id}`,
        children: [
          jsx('div', {
            className: 'hc-meta',
            children: [
              jsx('span', { className: 'hc-pill', children: linked.status }),
              jsx('span', { children: linked.assignee ? fill(t('executor'), { who: linked.assignee }) : t('noExecutor') }),
              jsx('span', { children: fill(t('attempts'), { n: linked.runs.length }) }),
              jsx('span', { children: fill(t('reports'), { n: linked.comments.length }) })
            ]
          }),
          jsx('div', { className: 'hc-kv', children: linked.title }),
          ...linked.runs.map((r, i) =>
            jsx('div', {
              key: `r${i}`,
              className: 'hc-act',
              children: [
                jsx('span', { className: 'hc-act-when', children: when(r.started) }),
                jsx('span', { className: 'hc-act-what', children: `${r.status}${r.outcome ? ` · ${r.outcome}` : ''}` }),
                jsx('span', { className: 'hc-act-note', children: r.summary || t('noBody') })
              ]
            })
          ),
          ...linked.comments.map((c, i) =>
            jsx('div', {
              key: `c${i}`,
              className: 'hc-cmt',
              children: [jsx('div', { className: 'hc-cmt-who', children: `${c.author} · ${when(c.at)}` }), jsx('div', { children: c.body })]
            })
          ),
          openCard
            ? jsx('div', { className: 'hc-ev', children: linked.body || t('cardNoBody') })
            : jsx('button', { className: 'hc-btn', onClick: () => setOpenCard(true), children: t('showCardBody') })
        ].filter(Boolean)
      })
    : null

  return jsx('div', {
    className: 'hc-loop',
    'data-turn': loop.turn,
    children: [
      jsx('div', {
        className: 'hc-top',
        children: jsx('div', {
          className: 'hc-cause',
          children: [jsx('span', { className: 'hc-num', children: `#${loop.id}` }), ` ${loop.cause}`]
        })
      }),
      jsx('div', {
        className: 'hc-meta',
        children: [
          jsx('span', { className: 'hc-pill', children: t(TURN_KEY[loop.turn] || 'turnNone') }),
          jsx('span', { children: loop.holder ? fill(t('wordFor'), { who: loop.holder }) : t('noTurn') }),
          jsx('span', { className: 'hc-pill', children: state }),
          jsx('span', {
            className: late ? 'hc-late' : '',
            children: late ? fill(t('late'), { time: human(-loop.remaining) }) : fill(t('left'), { time: human(loop.remaining), when: when(loop.deadline) })
          }),
          jsx('span', { children: `${loop.customer} → ${loop.performer}` }),
          jsx('span', { className: 'hc-pill', children: loop.class }),
          loop.level > 1 ? jsx('span', { className: 'hc-pill hc-esc', children: fill(t('level'), { n: loop.level }) }) : null
        ].filter(Boolean)
      }),
      jsx('div', {
        className: 'hc-actions',
        children: [
          ...available.map((verb) =>
            jsx('button', { className: 'hc-btn', disabled: busy, onClick: () => run(verb), children: t(VERB_KEY[verb]) })
          ),
          ...(need
            ? [
                jsx('input', {
                  className: 'hc-input',
                  placeholder: t(need.key),
                  value: draft[loop.inline] || '',
                  onChange: (e) => setDraft({ ...draft, [loop.inline]: e.target.value })
                })
              ]
            : [])
        ]
      }),
      available.length
        ? jsx('div', {
            className: 'hc-hint',
            children: available.map((verb) => `${t(VERB_KEY[verb])} — ${t(`${VERB_KEY[verb]}Hint`)}`).join('  ·  ')
          })
        : null,
      loop.objection ? jsx('div', { className: 'hc-note', children: loop.objection }) : null,
      about,
      evidence,
      history,
      feed,
      card
    ].filter(Boolean)
  })
}

function CheredaPage({ ctx }) {
  const t = usePluginI18n(ID)
  const [busy, setBusy] = useState(false)
  const [inline, setInline] = useState({})
  const [note, setNote] = useState('')
  const [gloss, setGloss] = useState(false)
  const [role, setRole] = useState('customer')
  const [filter, setFilter] = useState('all')

  // заметка не должна висеть вечно: гаснет сама
  useEffect(() => {
    if (!note) return undefined
    const timer = setTimeout(() => setNote(''), 8000)

    return () => clearTimeout(timer)
  }, [note])

  const query = useQuery({ queryKey: [ID, 'loops'], queryFn: () => ctx.rest('/loops'), refetchInterval: 5000 })

  const act = async ({ verb, params, loop }) => {
    if (verb === 'сказать' && !String(params.text || '').trim()) {
      setNote(t('emptySay'))

      return
    }
    if (verb === 'описать' && !String(params.text || '').trim()) {
      setNote(t('emptyAbout'))

      return
    }
    if (NEEDS[verb] && !params[NEEDS[verb].field]) {
      setInline({ ...inline, [loop.id]: verb })
      setNote(fill(t('needField'), { verb: t(VERB_KEY[verb]), field: t(NEEDS[verb].key) }))

      return
    }
    setBusy(true)
    setNote('')
    try {
      const out = await ctx.rest('/act', { method: 'POST', body: { verb, params } })
      const line = (out.stdout || out.stderr || '').trim().split('\n')[0] || `code ${out.code}`
      setNote(line)
      setInline({ ...inline, [loop.id]: null })
      await query.refetch()
    } catch (err) {
      setNote(fill(t('failed'), { error: err?.message || err }))
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    setBusy(true)
    try {
      const out = await ctx.rest('/act', { method: 'POST', body: { verb: 'проверить', params: {} } })
      setNote((out.stdout || out.stderr || '').trim().split('\n').slice(-3).join(' '))
      await query.refetch()
    } catch (err) {
      setNote(fill(t('verifyFailed'), { error: err?.message || err }))
    } finally {
      setBusy(false)
    }
  }

  if (query.isLoading) return jsx('div', { className: 'hc-page', children: jsx('div', { className: 'hc-sub', children: t('loading') }) })

  if (query.error) {
    return jsx('div', {
      className: 'hc-page',
      children: [
        jsx('h2', { className: 'hc-title', children: t('name') }),
        jsx('div', { className: 'hc-warn', children: fill(t('backendOff'), { error: query.error?.message || query.error }) })
      ]
    })
  }

  const loops = (query.data?.loops || []).map((l) => ({ ...l, inline: inline[l.id] || null }))
  const mine = loops.filter((l) => l.turn === 'customer').length
  const theirs = loops.filter((l) => l.turn === 'performer').length
  const lateCount = loops.filter((l) => l.remaining <= 0).length
  const performers = [...new Set(loops.map((l) => l.performer))].filter(Boolean)
  const customers = [...new Set(loops.map((l) => l.customer))].filter(Boolean)
  const who = role === 'performer' ? performers[0] || '' : customers[0] || ''

  const visible = loops.filter((l) => {
    if (filter === 'mine') return l.turn === 'customer'
    if (filter === 'theirs') return l.turn === 'performer'
    if (filter === 'late') return l.remaining <= 0

    return true
  })

  const chip = (id, label, count) =>
    jsx('button', {
      className: `hc-chip${filter === id ? ' hc-chip-on' : ''}`,
      onClick: () => setFilter(id),
      children: `${label}${count === undefined ? '' : ` ${count}`}`
    })

  return jsx('div', {
    className: 'hc-page',
    children: [
      jsx('div', {
        className: 'hc-head',
        children: [
          jsx('h2', { className: 'hc-title', children: t('name') }),
          jsx('span', { className: 'hc-sub', children: fill(t('summary'), { performer: theirs, customer: mine, total: loops.length }) }),
          jsx('button', { className: 'hc-btn', disabled: busy, onClick: verify, children: t('verify') })
        ]
      }),
      jsx('div', {
        className: 'hc-bar',
        children: [
          chip('all', t('filterAll'), loops.length),
          chip('mine', t('filterMine'), mine),
          chip('theirs', t('filterTheirs'), theirs),
          chip('late', t('filterLate'), lateCount),
          jsx('span', { className: 'hc-sep' }),
          jsx('span', { className: 'hc-sub', children: t('speakAs') }),
          jsx('button', {
            className: `hc-chip${role === 'customer' ? ' hc-chip-on' : ''}`,
            onClick: () => setRole('customer'),
            children: fill(t('asCustomer'), { who: who || '—' })
          }),
          jsx('button', {
            className: `hc-chip${role === 'performer' ? ' hc-chip-on' : ''}`,
            onClick: () => setRole('performer'),
            children: fill(t('asPerformer'), { who: performers[0] || '—' })
          })
        ]
      }),
      jsx(Glossary, { t, open: gloss, toggle: () => setGloss(!gloss) }),
      note ? jsx('div', { className: 'hc-note', children: note }) : null,
      visible.length
        ? jsx('div', { children: visible.map((loop) => jsx(Loop, { key: loop.id, loop, onAct: act, busy, t, role })) })
        : jsx('div', { className: 'hc-empty', children: loops.length ? t('noMatch') : t('empty') })
    ].filter(Boolean)
  })
}

function installStyle(ctx) {
  if (document.querySelector('style[data-chereda]')) return
  const style = document.createElement('style')
  style.dataset.chereda = '1'
  style.textContent = CSS
  document.head.append(style)
  ctx.onDispose?.(() => style.remove())
}

export default {
  id: ID,
  name: 'Череда',
  description: 'Obligation loops: whose move, the clock, the evidence — moves as buttons.',
  defaultEnabled: true,
  register(ctx) {
    ctx.i18n.register(LOCALES)
    installStyle(ctx)

    const labels = () => [
      { id: 'nav', area: 'sidebar.nav', order: 51, data: { codicon: 'git-pull-request', label: ctx.i18n.t('nav'), path: PATH } },
      {
        id: 'open',
        area: 'palette',
        data: {
          id: 'chereda.open',
          label: ctx.i18n.t('palette'),
          keywords: ['череда', 'петли', 'chereda', 'loops', 'queue', 'obligation'],
          run: () => host.navigate(PATH)
        }
      }
    ]

    ctx.register({ id: 'page', area: 'routes', data: { path: PATH }, render: () => jsx(CheredaPage, { ctx }) })
    ctx.registerMany(labels())

    // при смене языка подписи меню и палитры перерегистрируются
    ctx.i18n.onChange?.(() => {
      ctx.unregister?.('nav')
      ctx.unregister?.('open')
      ctx.registerMany(labels())
    })
  }
}
