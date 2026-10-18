/**
 * Череда в приложении Hermes.
 *
 * Петли обязательств вместо статусов: у каждой петли видно, **чей ход**, сколько
 * осталось до срока и чем дело доказано. Кнопки — это глаголы Череда, а не своя
 * логика: панель зовёт `/api/plugins/chereda/act`, бэкенд зовёт настоящий CLI
 * `череда`, и правила (не в свой ход не говорят, отказ только с причиной)
 * остаются в одном месте.
 *
 * Данные: `ctx.rest` → `/api/plugins/chereda/…` (нужен включённый плагин и
 * перезапущенный gateway; без бэкенда страница честно об этом пишет).
 */

import { host, useQuery } from '@hermes/plugin-sdk'
import { useState } from 'react'
import { jsx } from 'react/jsx-runtime'

const ID = 'chereda'
const PATH = '/chereda'

const CSS = `
.hc-page{padding:18px 22px 40px;max-width:1040px;margin:0 auto;overflow-y:auto;overflow-x:hidden;height:100%;scrollbar-gutter:stable}
.hc-head{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:14px}
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
.hc-cause{font-weight:600;margin-bottom:4px}
.hc-meta{display:flex;gap:10px;flex-wrap:wrap;color:var(--ui-text-tertiary,#8b93a7);font-size:12px;margin-bottom:8px}
.hc-pill{border:1px solid var(--ui-border,#2a2f3a);border-radius:999px;padding:0 7px}
.hc-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.hc-input{font:inherit;font-size:12.5px;background:var(--ui-bg,#12141a);color:inherit;
  border:1px solid var(--ui-border,#2a2f3a);border-radius:7px;padding:4px 8px;min-width:280px;flex:1}
.hc-note{font-size:12.5px;color:var(--ui-text-tertiary,#8b93a7);margin-top:6px;white-space:pre-wrap}
.hc-top{display:flex;gap:10px;align-items:flex-start;justify-content:space-between}
.hc-num{color:var(--ui-text-tertiary,#8b93a7);font-weight:600}
.hc-more{flex:none;font-size:11.5px;padding:2px 8px}
.hc-late{color:#f87171;font-weight:600}
.hc-esc{color:#fbbf24;border-color:#78350f}
.hc-detail{margin-top:9px;border-top:1px dashed var(--ui-border,#2a2f3a);padding-top:8px}
.hc-kv{font-size:12px;color:var(--ui-text-tertiary,#8b93a7);margin-bottom:5px}
.hc-history{margin-top:8px}
.hc-act{display:flex;gap:8px;font-size:12px;padding:2px 0;border-bottom:1px solid rgba(255,255,255,.03)}
.hc-act-when{color:var(--ui-text-tertiary,#8b93a7);min-width:78px}
.hc-act-what{min-width:96px;color:#cfd6e4}
.hc-act-who{min-width:88px;color:#93c5fd}
.hc-act-note{color:var(--ui-text-tertiary,#8b93a7);flex:1;white-space:pre-wrap}
.hc-sec{margin-top:9px;border-top:1px dashed var(--ui-border,#2a2f3a);padding-top:7px}
.hc-sec-t{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ui-text-tertiary,#8b93a7);margin-bottom:4px}
.hc-cmt{background:rgba(59,130,246,.06);border-left:3px solid #33405a;border-radius:0 6px 6px 0;padding:5px 9px;margin:5px 0;font-size:12px;white-space:pre-wrap;color:#cfd6e4}
.hc-cmt-who{color:var(--ui-text-tertiary,#8b93a7);font-size:11px;margin-bottom:3px}
.hc-desc{white-space:pre-wrap;font-size:12.5px;color:#cfd6e4;background:var(--ui-bg,#12141a);border:1px solid var(--ui-border,#2a2f3a);border-radius:7px;padding:8px 10px;max-height:220px;overflow-y:auto;scrollbar-gutter:stable}
.hc-cmt-worker{border-left-color:#3b82f6;background:rgba(59,130,246,.10)}
.hc-desc-full{max-height:none}
.hc-empty{border:1px dashed var(--ui-border,#2a2f3a);border-radius:10px;padding:16px;color:var(--ui-text-tertiary,#8b93a7)}
.hc-warn{border:1px solid #7f1d1d;background:#2a1215;border-radius:9px;padding:12px 14px;margin-bottom:14px;color:#fecaca;font-size:12.5px}
.hc-ev{font-family:var(--font-mono,monospace);font-size:11.5px;color:#cfd6e4;
  background:var(--ui-bg,#12141a);border:1px solid var(--ui-border,#2a2f3a);border-radius:7px;
  padding:6px 8px;margin-top:6px;white-space:pre-wrap;word-break:break-word;max-height:200px;overflow-y:auto;scrollbar-gutter:stable}
`

const STATE_WORD = {
  'просит': 'просит',
  'обещано': 'обещано',
  'объявлено': 'объявлено',
  'возражение': 'возражение',
  'отказ': 'отказ'
}

const TURN_WORD = { customer: 'ход заказчика', performer: 'ход делающего', none: 'закрыта' }

function human(secs) {
  if (secs === null || secs === undefined) return '—'
  const v = Math.abs(secs)
  const text = v >= 86400 ? `${Math.floor(v / 86400)}д` : v >= 3600 ? `${Math.floor(v / 3600)}ч` : v >= 60 ? `${Math.floor(v / 60)}м` : `${v}с`

  return secs < 0 ? `−${text}` : text
}

function actionsFor(loop) {
  const { turn, state } = loop

  if (turn === 'performer' && (state === 'просит' || state === 'возражение')) return ['обещать', 'отказать']
  if (turn === 'performer' && state === 'обещано') return ['сделать']
  if (turn === 'customer' && state === 'объявлено') return ['принять', 'возразить']
  if (turn === 'customer' && state === 'отказ') return ['снять']

  return []
}

/** Какие поля просит глагол — по ним и рисуем поле ввода. */
const NEEDS = {
  обещать: { field: 'for', label: 'на сколько секунд', placeholder: '3600' },
  отказать: { field: 'reason', label: 'причина отказа (обязательно)', placeholder: 'почему не берусь' },
  сделать: { field: 'proof', label: 'команда-доказательство', placeholder: 'cargo test -p pdfcraft-smtp' },
  возразить: { field: 'reason', label: 'причина возражения (обязательно)', placeholder: 'нет теста на пустой ввод' },
  принять: null,
  снять: null
}

function when(epoch) {
  if (!epoch) return '—'

  return new Date(epoch * 1000).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
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

function Section({ title, children, tone }) {
  return jsx('div', {
    className: 'hc-sec',
    children: [jsx('div', { className: `hc-sec-t${tone ? ` hc-tone-${tone}` : ''}`, children: title }), children]
  })
}

function Loop({ loop, onAct, busy }) {
  const [draft, setDraft] = useState({})
  const [openBody, setOpenBody] = useState(false)
  const [fullAbout, setFullAbout] = useState(true)
  const need = loop.inline ? NEEDS[loop.inline] : null
  const state = STATE_WORD[loop.state] || loop.state
  const late = loop.remaining <= 0
  const linked = loop.linked

  const run = (verb) => {
    const params = { id: loop.id }
    const value = draft[verb]

    if (verb === 'сказать') {
      params.who = loop.performer
      params.text = draft.say || ''

      if (!params.text.trim()) {
        onAct({ verb: 'hint', loop, text: `#${loop.id}: пустое сообщение не отправить` })

        return
      }
      onAct({ verb, params, loop })

      return
    }
    if (NEEDS[verb] && value) params[NEEDS[verb].field] = value
    params.who = loop.performer
    onAct({ verb, params, loop })
  }

  const about = loop.about
    ? jsx(Section, {
        title: `описание (${loop.about.length} симв.)`,
        children: [
          jsx('div', { className: `hc-desc${fullAbout ? ' hc-desc-full' : ''}`, children: loop.about }),
          jsx('button', {
            className: 'hc-btn hc-more',
            onClick: () => setFullAbout(!fullAbout),
            children: fullAbout ? 'свернуть описание' : 'развернуть описание целиком'
          })
        ]
      })
    : null

  const feed = jsx(Section, {
    title: `лента${loop.feed && loop.feed.length ? ` (${loop.feed.length})` : ''}`,
    children: [
      ...(loop.feed || []).map((msg, i) =>
        jsx('div', { key: `f${i}`, className: `hc-cmt${msg.who === loop.performer ? ' hc-cmt-worker' : ''}`, children: [jsx('div', { className: 'hc-cmt-who', children: `${msg.who} · ${when(msg.at)}` }), jsx('div', { children: msg.text })] })
      ),
      jsx('div', {
        className: 'hc-actions',
        children: [
          jsx('input', {
            className: 'hc-input',
            placeholder: 'сказать в ленту — отчёт, вопрос, заметка',
            value: draft.say || '',
            onChange: (e) => setDraft({ ...draft, say: e.target.value })
          }),
          jsx('button', {
            className: 'hc-btn',
            disabled: busy,
            onClick: () => run('сказать'),
            children: 'сказать'
          })
        ]
      })
    ]
  })

  const evidence = loop.evidence
    ? jsx(Section, {
        title: 'доказательство',
        children: jsx('div', {
          className: 'hc-ev',
          children: [
            `$ ${loop.evidence.command}`,
            loop.evidence.dir ? `  в ${loop.evidence.dir}` : null,
            `  ждали код ${loop.evidence.expect} · отпечаток ${loop.evidence.digest}`,
            loop.evidence.excerpt ? `  вывод:\n  ${String(loop.evidence.excerpt).split('\n').slice(0, 6).join('\n  ')}` : null
          ]
            .filter(Boolean)
            .join('\n')
        })
      })
    : null

  const history = loop.history && loop.history.length
    ? jsx(Section, {
        title: `ходы (${loop.history.length})`,
        children: jsx('div', {
          children: loop.history.map((act, i) => jsx(Act, { key: i, act }))
        })
      })
    : null

  const card = linked
    ? jsx(Section, {
        title: `карточка канбана ${linked.id}`,
        children: [
          jsx('div', {
            className: 'hc-meta',
            children: [
              jsx('span', { className: 'hc-pill', children: linked.status }),
              jsx('span', { children: linked.assignee ? `исполнитель ${linked.assignee}` : 'без исполнителя' }),
              jsx('span', { children: `попыток ${linked.runs.length}` }),
              jsx('span', { children: `отчётов ${linked.comments.length}` })
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
                jsx('span', { className: 'hc-act-note', children: r.summary || '—' })
              ]
            })
          ),
          ...linked.comments.map((c, i) =>
            jsx('div', {
              key: `c${i}`,
              className: 'hc-cmt',
              children: [
                jsx('div', { className: 'hc-cmt-who', children: `${c.author} · ${when(c.at)}` }),
                jsx('div', { children: c.body })
              ]
            })
          ),
          openBody
            ? jsx('div', { className: 'hc-ev', children: linked.body || 'описания нет' })
            : jsx('button', {
                className: 'hc-btn hc-more',
                onClick: () => setOpenBody(true),
                children: 'показать описание карточки'
              })
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
          jsx('span', { className: 'hc-pill hc-turn', children: TURN_WORD[loop.turn] || loop.turn }),
          jsx('span', { children: loop.holder ? `слово за ${loop.holder}` : 'хода нет' }),
          jsx('span', { className: 'hc-pill', children: state }),
          jsx('span', {
            className: late ? 'hc-late' : '',
            children: late ? `часы вышли ${human(-loop.remaining)} назад` : `осталось ${human(loop.remaining)} · до ${when(loop.deadline)}`
          }),
          jsx('span', { children: `${loop.customer} → ${loop.performer}` }),
          jsx('span', { className: 'hc-pill', children: loop.class }),
          loop.history && loop.history.length ? jsx('span', { children: `ходов ${loop.history.length}` }) : null,
          loop.level > 1 ? jsx('span', { className: 'hc-pill hc-esc', children: `уровень ${loop.level} — сигнал выше` }) : null
        ].filter(Boolean)
      }),
      jsx('div', {
        className: 'hc-actions',
        children: [
          ...actionsFor(loop).map((verb) =>
            jsx('button', { className: 'hc-btn', disabled: busy, onClick: () => run(verb), children: verb })
          ),
          ...(need
            ? [
                jsx('input', {
                  className: 'hc-input',
                  placeholder: need.label,
                  value: draft[loop.inline] || '',
                  onChange: (e) => setDraft({ ...draft, [loop.inline]: e.target.value })
                })
              ]
            : [])
        ]
      }),
      loop.objection ? jsx('div', { className: 'hc-note', children: `возражение: ${loop.objection}` }) : null,
      about,
      evidence,
      history,
      feed,
      card
    ].filter(Boolean)
  })
}

function CheredaPage({ ctx }) {
  const [busy, setBusy] = useState(false)
  const [inline, setInline] = useState({})
  const [note, setNote] = useState('')

  const query = useQuery({
    queryKey: [ID, 'loops'],
    queryFn: () => ctx.rest('/loops'),
    refetchInterval: 5000
  })

  const act = async ({ verb, params, loop, text }) => {
    if (verb === 'hint') {
      setNote(text)

      return
    }
    if (NEEDS[verb] && !params[NEEDS[verb].field]) {
      setInline({ ...inline, [loop.id]: verb })
      setNote(`#${loop.id}: «${verb}» — заполни «${NEEDS[verb].label}» и нажми ещё раз`)

      return
    }
    setBusy(true)
    setNote('')
    try {
      const out = await ctx.rest('/act', { method: 'POST', body: { verb, params } })
      const line = (out.stdout || out.stderr || '').trim().split('\n')[0] || `код ${out.code}`
      setNote(line)
      setInline({ ...inline, [loop.id]: null })
      await query.refetch()
    } catch (err) {
      setNote(`не вышло: ${err?.message || err}`)
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
      setNote(`проверка не прошла: ${err?.message || err}`)
    } finally {
      setBusy(false)
    }
  }

  if (query.isLoading) return jsx('div', { className: 'hc-page', children: jsx('div', { className: 'hc-sub', children: 'читаю петли…' }) })

  if (query.error) {
    return jsx('div', {
      className: 'hc-page',
      children: [
        jsx('h2', { className: 'hc-title', children: 'Череда' }),
        jsx('div', {
          className: 'hc-warn',
          children: `Бэкенд Череда не подключён: ${query.error?.message || query.error}. Плагин включён, но gateway должен перезапуститься, чтобы смонтировать /api/plugins/chereda.`
        })
      ]
    })
  }

  const loops = (query.data?.loops || []).map((l) => ({ ...l, inline: inline[l.id] || null }))
  const mine = loops.filter((l) => l.turn === 'customer').length
  const theirs = loops.filter((l) => l.turn === 'performer').length

  return jsx('div', {
    className: 'hc-page',
    children: [
      jsx('div', {
        className: 'hc-head',
        children: [
          jsx('h2', { className: 'hc-title', children: 'Череда' }),
          jsx('span', { className: 'hc-sub', children: `${theirs} на ходу делающих · ${mine} на твоём ходу · всего ${loops.length}` }),
          jsx('button', { className: 'hc-btn', disabled: busy, onClick: verify, children: 'проверить реальность' })
        ]
      }),
      note ? jsx('div', { className: 'hc-note', children: note }) : null,
      loops.length
        ? jsx('div', { children: loops.map((loop) => jsx(Loop, { key: loop.id, loop, onAct: act, busy })) })
        : jsx('div', { className: 'hc-empty', children: 'открытых петель нет — нечего держать в голове' })
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
  description: 'Петли обязательств: чей ход, часы, доказательство — и глаголы хода кнопками.',
  defaultEnabled: true,
  register(ctx) {
    installStyle(ctx)

    ctx.registerMany([
      { id: 'page', area: 'routes', data: { path: PATH }, render: () => jsx(CheredaPage, { ctx }) },
      {
        id: 'nav',
        area: 'sidebar.nav',
        order: 51,
        data: { codicon: 'git-pull-request', label: 'Череда', path: PATH }
      },
      {
        id: 'open',
        area: 'palette',
        data: {
          id: 'chereda.open',
          label: 'Череда: петли',
          keywords: ['череда', 'петли', 'chereda', 'loops', 'queue'],
          run: () => host.navigate(PATH)
        }
      }
    ])
  }
}
