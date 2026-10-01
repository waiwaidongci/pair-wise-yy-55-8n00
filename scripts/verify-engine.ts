import assert from 'node:assert'
import {
  applyOp, buildPlan, buildTrackBaseline, measureOfNote, migrateDraft,
  noteSignature, opAffectedMeasures, recomputeComments, recomputePublishingChecks,
} from '../src/handoff/engine.ts'
import type {
  OfflineBundle, PublishingCheck, ScoreComment, Track,
} from '../src/types.ts'

let pass = 0
const ok = (name: string, cond: boolean) => { assert.ok(cond, name); pass += 1; console.log('  ✓', name) }

/* ---------- 构造出发态 ---------- */
const mkTrack = (): Track => ({
  id: 'TR-03', name: '圆号', instrument: 'Horn in F', clef: 'treble', transposition: -7, color: '#000',
  notes: [
    { id: 'N-5', key: 'd/4', duration: 'q', dynamic: 'mf', tie: false, expression: '' },
    { id: 'N-6', key: 'e/4', duration: 'q', dynamic: 'mf', tie: false, expression: '' },
  ],
})
const departure = mkTrack()
const baseline = buildTrackBaseline(departure, 'tester')

/* 场景 1：双方都改 N-5.dynamic → 复核区；只离线改 N-6.dynamic → 写入计划 */
const studio = mkTrack()
studio.notes[0]!.dynamic = 'f' // 指挥/工作室改动
const bundle: OfflineBundle = {
  id: 'OB-1', trackId: 'TR-03', author: '声部长', device: 'x', createdAt: '', baselineId: baseline.id,
  transpositionFrom: -7,
  patches: [
    { noteId: 'N-5', base: { dynamic: 'mf' }, fields: { dynamic: 'p' } },
    { noteId: 'N-6', base: { dynamic: 'mf' }, fields: { dynamic: 'mp' } },
  ],
  added: [], removed: [],
}
const plan1 = buildPlan(studio, baseline, bundle)
ok('双方同改字段进入复核区', plan1.review.some((r) => r.kind === 'note-field' && r.noteId === 'N-5' && r.field === 'dynamic'))
ok('复核区保留三方值 base/studio/offline', plan1.review[0]!.baseValue === 'mf' && plan1.review[0]!.studioValue === 'f' && plan1.review[0]!.offlineValue === 'p')
ok('仅离线侧改动进入写入计划', plan1.ops.some((o) => o.kind === 'field' && o.noteId === 'N-6'))
ok('计划不触碰被冲突的 N-5', !plan1.ops.some((o) => o.kind === 'field' && o.noteId === 'N-5'))

/* 场景 2：逐操作写入 + 失败断点；模拟在第 1 项失败，重试不重放已交 */
let live = structuredClone(studio)
const applyAll = (ops: typeof plan1.ops, breakAt: number) => {
  let cursor = 0; let failed = false
  for (let i = 0; i < ops.length; i++) {
    if (i === breakAt && !failed) { failed = true; break }
    const aff = opAffectedMeasures(live, ops[i]!)
    live = applyOp(live, ops[i]!)
    cursor += 1
    void aff
  }
  return cursor
}
const ops = plan1.ops
const c1 = applyAll(ops, 0)
ok('首次写入在第 1 项失败，已交 0 项', c1 === 0)
// 重试：从 cursor 继续，一次性写完全部
let cursor2 = c1
for (let i = cursor2; i < ops.length; i++) { live = applyOp(live, ops[i]!); cursor2 += 1 }
ok('断点重试后剩余操作全部落盘', cursor2 === ops.length)
ok('N-6 取离线值 mp（工作室值未被覆盖 N-5）', live.notes[1]!.dynamic === 'mp' && live.notes[0]!.dynamic === 'f')

/* 场景 3：新增按 afterNoteId 锚定；删除双方都碰 → 复核 */
const bundle2: OfflineBundle = {
  id: 'OB-2', trackId: 'TR-03', author: '声部长', device: 'x', createdAt: '', baselineId: baseline.id, transpositionFrom: -7,
  patches: [],
  added: [{ note: { id: 'N-99', key: 'c/4', duration: '8', dynamic: 'p', tie: false, expression: '' }, afterNoteId: 'N-5' }],
  removed: [{ noteId: 'N-6', contentSignature: noteSignature(departure.notes[1], -7) }],
}
const studio2 = mkTrack()
studio2.notes[1]!.dynamic = 'ff' // 工作室在删除前又改过 N-6
const plan2 = buildPlan(studio2, baseline, bundle2)
ok('新增音进入写入计划并锚定 N-5 之后', plan2.ops.some((o) => o.kind === 'add' && o.note.id === 'N-99' && o.afterNoteId === 'N-5'))
ok('离线删除但工作室又改过 → 删除冲突进复核', plan2.review.some((r) => r.kind === 'note-removed' && r.noteId === 'N-6'))
let live2 = structuredClone(studio2)
for (const op of plan2.ops) live2 = applyOp(live2, op)
ok('新增音插入 N-5 之后（索引 1）', live2.notes[1]!.id === 'N-99')

/* 场景 4：移调双方都动 → 复核；仅离线动 → 计划且分谱与总谱同步 */
const studio3 = mkTrack() // 仍 -7
const bundleMove: OfflineBundle = {
  id: 'OB-3', trackId: 'TR-03', author: '声部长', device: 'x', createdAt: '', baselineId: baseline.id,
  transpositionFrom: -7, transpositionTo: -5, patches: [], added: [], removed: [],
}
const plan3 = buildPlan(studio3, baseline, bundleMove)
ok('单方移调进入写入计划', plan3.ops.some((o) => o.kind === 'transposition' && o.to === -5))
const moved = applyOp(studio3, plan3.ops.find((o) => o.kind === 'transposition')!)
ok('移调后分谱音符随总谱一起移调（d/4 +2 = e/4）', moved.notes[0]!.key === 'e/4' && moved.transposition === -5)
const studioMoved = mkTrack(); studioMoved.transposition = -2
const bundleClash: OfflineBundle = { ...bundleMove, id: 'OB-4' }
ok('双方都改移调进入复核区', buildPlan(studioMoved, baseline, bundleClash).review.some((r) => r.kind === 'transposition'))

/* 场景 5：评论随音符失效重算、随标识重新定位小节、旧评论不删除 */
const trackForComments: Track = mkTrack()
const comments: ScoreComment[] = [
  { id: 'C1', measure: 2, author: '指挥', content: 'x', resolved: false, trackId: 'TR-03', noteId: 'N-6', baselineMeasure: 2, signature: noteSignature(mkTrack().notes[1], -7) },
]
// N-6 力度变了
const changedTrack = structuredClone(trackForComments); changedTrack.notes[1]!.dynamic = 'p'
const recomputed = recomputeComments(comments, [changedTrack], [{ trackId: 'TR-03', measures: [2], transpositionChanged: false }])
ok('音符变化 → 评论置 stale 且不删除', recomputed[0]!.stale === true && recomputed.length === 1)
// 增删导致小节移动：在 N-5 后插入 4 个音，N-6 由第 1 小节移到第 2 小节（index 5 → measure 2）
let movedNotesTrack = structuredClone(trackForComments)
movedNotesTrack.notes.splice(1, 0,
  { id: 'A', key: 'c/4', duration: 'q', dynamic: 'p', tie: false, expression: '' },
  { id: 'B', key: 'c/4', duration: 'q', dynamic: 'p', tie: false, expression: '' },
  { id: 'C', key: 'c/4', duration: 'q', dynamic: 'p', tie: false, expression: '' },
  { id: 'D', key: 'c/4', duration: 'q', dynamic: 'p', tie: false, expression: '' },
)
ok('小节计算正确（index 5 → 第 2 小节）', measureOfNote(5) === 2)
const relocated = recomputeComments(
  [{ ...comments[0]!, measure: 1, baselineMeasure: 1, signature: undefined }],
  [movedNotesTrack],
  [{ trackId: 'TR-03', measures: [1, 2], transpositionChanged: false }],
)
ok('评论按音符标识重新定位到第 2 小节', relocated[0]!.measure === 2 && relocated[0]!.stale === true)

/* 场景 6：出版检查随音符/移调失效重算 */
const checks: PublishingCheck[] = [
  { id: 'K1', label: '移调同步', kind: 'transposition', trackId: 'TR-03', status: 'pass', detail: '', signature: 'tp:-7' },
  { id: 'K2', label: '节奏', kind: 'rhythm', trackId: 'TR-03', status: 'pass', detail: '', signature: 'ry:2' },
]
const afterMove = moved // -5, 2 notes
const rc = recomputePublishingChecks(checks, [afterMove], [{ trackId: 'TR-03', measures: [1], transpositionChanged: true }])
ok('移调检查重算且指纹更新为 tp:-5', rc[0]!.signature === 'tp:-5' && rc[0]!.recalculated === true)
const threeNote = structuredClone(mkTrack()); threeNote.notes = threeNote.notes.slice(0, 1)
const rc2 = recomputePublishingChecks([checks[1]!], [threeNote], [{ trackId: 'TR-03', measures: [1], transpositionChanged: false }])
ok('音符数不为 4 的倍数 → 节奏检查重算为不通过', rc2[0]!.status === 'fail' && rc2[0]!.recalculated === true)

/* 场景 7：旧草稿升级 —— 先回填声部编号/音符标识，再升级 */
const oldComments: ScoreComment[] = [{ id: 'OLD-1', measure: 1, author: '指挥', content: '圆号第 1 小节再弱一级', resolved: false }]
const migrated = migrateDraft({}, [mkTrack()], oldComments)
ok('旧评论回填声部编号 TR-03', migrated.comments[0]!.trackId === 'TR-03')
ok('旧评论回填小节首音标识 N-5 与指纹', migrated.comments[0]!.noteId === 'N-5' && typeof migrated.comments[0]!.signature === 'string')
ok('能识别声部的旧评论不置 stale', migrated.comments[0]!.stale !== true)
const unknown = migrateDraft({}, [mkTrack()], [{ id: 'OLD-2', measure: 1, author: 'x', content: '某声部需调整', resolved: false }])
ok('识别不出声部时保留为待人工指派', unknown.comments[0]!.trackId === undefined && unknown.comments[0]!.stale === true)
const noIdTrack: Track = { ...mkTrack(), notes: mkTrack().notes.map((n) => ({ ...n, id: '' })) }
const legacyNotes = migrateDraft({ tracks: [noIdTrack] }, [], [])
ok('旧无 id 音符升级时补齐稳定标识', legacyNotes.tracks[0]!.notes.every((n) => n.id.startsWith('N-legacy-')))

console.log(`\n全部通过：${pass} 项断言`)
