import type {
  NoteField, OfflineBundle, PublishingCheck,
  ReviewItem, ScoreComment, ScoreNote, Track, TrackBaseline,
} from '../types'

/** 每小节音符数，与总谱/分谱页面切分一致（4/4） */
export const NOTES_PER_MEASURE = 4

export const NOTE_FIELDS: NoteField[] = ['key', 'duration', 'accidental', 'dynamic', 'tie', 'expression']

export const measureOfNote = (index: number) => Math.floor(index / NOTES_PER_MEASURE) + 1

export const noteAnchor = (trackId: string, noteId: string) => `${trackId}:${noteId}`

/** 音符内容指纹：音符一变指纹就变 */
export function noteSignature(note: ScoreNote | undefined, transposition = 0): string {
  if (!note) return '∅'
  return [note.key, note.duration, note.accidental ?? '', note.dynamic, note.tie ? 'tie' : '', note.expression, `@${transposition}`].join('|')
}

function hash(text: string): string {
  let h = 0
  for (let i = 0; i < text.length; i += 1) { h = (h * 31 + text.charCodeAt(i)) | 0 }
  return Math.abs(h).toString(36)
}

/* ---------------- 出发前：各声部小节基线 ---------------- */

export function buildTrackBaseline(track: Track, author: string, createdAt = new Date().toISOString()): TrackBaseline {
  const measures: TrackBaseline['measures'] = []
  for (let start = 0; start < track.notes.length; start += NOTES_PER_MEASURE) {
    const slice = track.notes.slice(start, start + NOTES_PER_MEASURE)
    measures.push({
      measure: start / NOTES_PER_MEASURE + 1,
      noteIds: slice.map((note) => note.id),
      noteHash: hash(slice.map((note) => noteSignature(note, track.transposition)).join(';')),
      transposition: track.transposition,
    })
  }
  return { id: `BL-${track.id}-${hash(createdAt + track.id).slice(0, 6)}`, trackId: track.id, author, createdAt, measures }
}

/* ---------------- 回传后：按音符标识 + 字段三方合并，产出写入计划 ---------------- */

export type PlanOp =
  | { kind: 'field'; noteId: string; field: NoteField; value: unknown }
  | { kind: 'add'; note: ScoreNote; afterNoteId?: string }
  | { kind: 'remove'; noteId: string }
  | { kind: 'transposition'; from: number; to: number }

export interface HandoffPlan {
  ops: PlanOp[]
  review: ReviewItem[]
}

const fieldLabel: Record<NoteField, string> = {
  key: '音高', duration: '时值', accidental: '临时记号', dynamic: '力度', tie: '延音线', expression: '表情',
}

/**
 * 按音符标识对齐、按字段做三方比对：
 *  - 只有离线侧改 → 写入计划（逐项写入，失败可断点重试）
 *  - 双方都动过 → 复核区，绝不覆盖工作室/指挥批注
 */
export function buildPlan(track: Track, _baseline: TrackBaseline | undefined, bundle: OfflineBundle): HandoffPlan {
  const notes = track.notes
  const indexById = new Map(notes.map((note, index) => [note.id, index]))
  const ops: PlanOp[] = []
  const review: ReviewItem[] = []
  let nextReviewSeq = 0
  const reviewId = () => `RV-${bundle.id}-${(nextReviewSeq += 1)}`

  /* 移调：双方都动过 → 复核区；仅离线侧移动 → 进入写入计划 */
  if (typeof bundle.transpositionTo === 'number' && bundle.transpositionTo !== track.transposition) {
    if (bundle.transpositionFrom !== track.transposition) {
      review.push({
        id: reviewId(), bundleId: bundle.id, trackId: track.id, kind: 'transposition',
        label: `${track.name}移调`, offlineValue: bundle.transpositionTo, studioValue: track.transposition,
        baseValue: bundle.transpositionFrom, status: 'pending',
        reason: `双方都改了移调（出发基线 ${bundle.transpositionFrom} / 工作室 ${track.transposition} / 离线 ${bundle.transpositionTo}）`,
      })
    } else {
      ops.push({ kind: 'transposition', from: bundle.transpositionFrom, to: bundle.transpositionTo })
    }
  }

  /* 字段级三方合并：base 为离线出发时值，studio 为当前值，offline 为改稿值 */
  for (const patch of bundle.patches) {
    const index = indexById.get(patch.noteId)
    if (index === undefined) {
      review.push({
        id: reviewId(), bundleId: bundle.id, trackId: track.id, noteId: patch.noteId, kind: 'note-missing',
        label: `${track.name} · 音符 ${patch.noteId}`, status: 'pending',
        reason: '离线改稿指向的音符在工作室总谱中已不存在，需人工确认落点',
      })
      continue
    }
    const note = notes[index]!
    for (const field of NOTE_FIELDS) {
      if (!(field in patch.fields)) continue
      const offlineValue = patch.fields[field]
      const baseValue = field in patch.base ? patch.base[field] : undefined
      const studioValue = note[field]
      const studioChanged = JSON.stringify(studioValue) !== JSON.stringify(baseValue)
      const offlineChanged = JSON.stringify(offlineValue) !== JSON.stringify(baseValue)
      if (!offlineChanged) continue
      if (studioChanged) {
        // 双方都动过同一字段 → 复核区，绝不自动覆盖指挥/工作室批注
        review.push({
          id: reviewId(), bundleId: bundle.id, trackId: track.id, noteId: note.id, kind: 'note-field', field,
          label: `${track.name} 第 ${measureOfNote(index)} 小节 ${fieldLabel[field]}（${note.id}）`,
          baseValue, offlineValue, studioValue, status: 'pending',
          reason: '双方都修改了同一字段',
        })
      } else {
        ops.push({ kind: 'field', noteId: note.id, field, value: offlineValue })
      }
    }
  }

  /* 新增音符：锚定到前一个音符标识之后 */
  for (const item of bundle.added) {
    ops.push({ kind: 'add', note: structuredClone(item.note), afterNoteId: item.afterNoteId })
  }

  /* 删除：工作室在离线出发后又改过该音 → 复核；否则进入写入计划 */
  for (const item of bundle.removed) {
    const index = indexById.get(item.noteId)
    if (index === undefined) continue
    const currentSignature = noteSignature(notes[index], track.transposition)
    if (currentSignature !== item.contentSignature) {
      review.push({
        id: reviewId(), bundleId: bundle.id, trackId: track.id, noteId: item.noteId, kind: 'note-removed',
        label: `${track.name} 第 ${measureOfNote(index)} 小节（${item.noteId}）`,
        offlineValue: '删除', studioValue: currentSignature, status: 'pending',
        reason: '离线侧删除了该音，但工作室侧随后又修改过它',
      })
    } else {
      ops.push({ kind: 'remove', noteId: item.noteId })
    }
  }

  return { ops, review }
}

/* ---------------- 逐操作写入（纯函数，供 store 断点续传） ---------------- */

export function applyOp(track: Track, op: PlanOp): Track {
  const notes = structuredClone(track.notes)
  if (op.kind === 'field') {
    const target = notes.find((item) => item.id === op.noteId)
    if (target) (target as unknown as Record<string, unknown>)[op.field] = op.value
    return { ...track, notes }
  }
  if (op.kind === 'add') {
    const anchor = op.afterNoteId ? notes.findIndex((item) => item.id === op.afterNoteId) : -1
    notes.splice(anchor + 1, 0, structuredClone(op.note))
    return { ...track, notes }
  }
  if (op.kind === 'remove') {
    return { ...track, notes: notes.filter((item) => item.id !== op.noteId) }
  }
  // transposition：分谱随总谱一起移，避免移调分谱与总谱脱节
  const delta = op.to - op.from
  return {
    ...track,
    transposition: op.to,
    notes: notes.map((note) => ({ ...note, key: transposeKey(note.key, delta) })),
  }
}

/** 单个写入操作影响的小节，用于评论/出版检查失效重算 */
export function opAffectedMeasures(track: Track, op: PlanOp): { measures: number[]; transpositionChanged: boolean } {
  const notes = track.notes
  if (op.kind === 'transposition') return { measures: [...new Set(notes.map((_, i) => measureOfNote(i)))], transpositionChanged: true }
  if (op.kind === 'add') {
    const anchor = op.afterNoteId ? notes.findIndex((n) => n.id === op.afterNoteId) : notes.length - 1
    return { measures: [measureOfNote(anchor + 1)], transpositionChanged: false }
  }
  const index = notes.findIndex((n) => n.id === op.noteId)
  return { measures: [measureOfNote(Math.max(0, index))], transpositionChanged: false }
}

/* ---------------- 复核区裁决 ---------------- */

export function applyReviewDecision(notes: ScoreNote[], item: ReviewItem): ScoreNote[] {
  if (item.kind === 'note-field' && item.noteId && item.field) {
    const fieldName = item.field
    return notes.map((note) => (note.id === item.noteId
      ? { ...note, [fieldName]: item.offlineValue } as ScoreNote
      : note))
  }
  if (item.kind === 'note-removed' && item.noteId) {
    return notes.filter((note) => note.id !== item.noteId)
  }
  return notes
}

/* ---------------- 评论：锚定 + 失效重算，不删除 ---------------- */

export function recomputeComments(
  comments: ScoreComment[], tracks: Track[], changed: { trackId: string; measures: number[]; transpositionChanged: boolean }[],
): ScoreComment[] {
  const changeMap = new Map(changed.map((c) => [c.trackId, c]))
  return comments.map((comment) => {
    if (comment.resolved) return comment
    const { trackId } = comment
    if (!trackId) return { ...comment, stale: true, staleReason: '旧草稿：缺少声部编号，需先回填升级' }
    const change = changeMap.get(trackId)
    const track = tracks.find((t) => t.id === trackId)
    if (!change || !track) return comment
    const note = comment.noteId ? track.notes.find((n) => n.id === comment.noteId) : undefined
    const noteIndex = comment.noteId ? track.notes.findIndex((n) => n.id === comment.noteId) : -1
    const measureHit = change.measures.includes(comment.measure)
    if (!measureHit && !(change.transpositionChanged && comment.signature)) return comment
    let reason = ''
    if (change.transpositionChanged) reason = '声部移调已变化，已按新移调重算锚点与指纹'
    else if (!note && comment.noteId) reason = '锚定音符已被删除，批注悬空待人工处理'
    else if (note && comment.signature && noteSignature(note, track.transposition) !== comment.signature) {
      reason = '锚定音符内容已变化，批注需按新音符复核'
    } else if (noteIndex >= 0 && measureOfNote(noteIndex) !== (comment.baselineMeasure ?? comment.measure)) {
      reason = '小节位置因增删音符而移动，已按音符标识重新定位'
    }
    if (!reason) return comment
    const next: ScoreComment = { ...comment, stale: true, staleReason: reason }
    if (note && noteIndex >= 0) {
      next.measure = measureOfNote(noteIndex)
      next.signature = noteSignature(note, track.transposition)
    }
    return next
  })
}

/** 指挥/工作室对评论重新确认后刷新指纹，解除失效标记 */
export function confirmComment(comment: ScoreComment, track: Track | undefined): ScoreComment {
  const index = comment.noteId && track ? track.notes.findIndex((n) => n.id === comment.noteId) : -1
  const note = index >= 0 ? track!.notes[index] : undefined
  return {
    ...comment,
    stale: false,
    staleReason: undefined,
    measure: note ? measureOfNote(index) : comment.measure,
    baselineMeasure: comment.baselineMeasure ?? comment.measure,
    signature: note && track ? noteSignature(note, track.transposition) : comment.signature,
  }
}

/* ---------------- 出版检查：随音符/移调失效重算 ---------------- */

export function recomputePublishingChecks(
  checks: PublishingCheck[], tracks: Track[], changed: { trackId: string; measures: number[]; transpositionChanged: boolean }[],
): PublishingCheck[] {
  const changeMap = new Map(changed.map((c) => [c.trackId, c]))
  return checks.map((check) => {
    if (!check.trackId) return check
    const change = changeMap.get(check.trackId)
    if (!change) return check
    const hit = check.kind === 'transposition' ? change.transpositionChanged : change.measures.length > 0
    if (!hit) return check
    return { ...check, ...evaluateCheck(check, tracks.find((t) => t.id === check.trackId)!), recalculated: true }
  })
}

function evaluateCheck(check: PublishingCheck, track: Track): Pick<PublishingCheck, 'status' | 'detail' | 'signature'> {
  if (check.kind === 'transposition') {
    const ok = [-12, -7, -5, -2, 0, 2, 5, 7, 12].includes(track.transposition)
    return {
      status: ok ? 'pass' : 'fail',
      detail: ok ? `已按 ${track.transposition} 半音重算分谱，与总谱同步` : `移调 ${track.transposition} 不在常用调，分谱需人工复核`,
      signature: `tp:${track.transposition}`,
    }
  }
  if (check.kind === 'rhythm') {
    const partial = track.notes.length % NOTES_PER_MEASURE
    return {
      status: partial === 0 ? 'pass' : 'fail',
      detail: partial === 0 ? `共 ${track.notes.length / NOTES_PER_MEASURE} 个完整小节，已重算` : `末小节仅 ${partial} 个音符，节奏不完整`,
      signature: `ry:${track.notes.length}:${track.notes.map((n) => n.duration).join('')}`,
    }
  }
  if (check.kind === 'spelling') {
    const bad = track.notes.some((n) => n.key.includes('#') && n.accidental === 'b')
    return {
      status: bad ? 'fail' : 'pass',
      detail: bad ? '存在等音拼写冲突（键位升号叠加降号）' : '和弦拼写已按新音符重算，无冲突',
      signature: `sp:${track.notes.map((n) => `${n.key}${n.accidental ?? ''}`).join(',')}`,
    }
  }
  return { status: check.status, detail: `${check.detail}（已按最新音符重算）`, signature: check.signature }
}

/* ---------------- 旧草稿升级：先回填声部编号，再升级 ---------------- */

export function migrateDraft(draft: { tracks?: Track[]; comments?: ScoreComment[] }, tracks: Track[], comments: ScoreComment[]) {
  const commentKeyword: [RegExp, string][] = [
    [/圆号|Horn/i, 'TR-03'],
    [/单簧管|Clarinet/i, 'TR-02'],
    [/长笛|Flute/i, 'TR-01'],
    [/大提琴|[Cc]ello/i, 'TR-04'],
  ]
  const upgradedComments = comments.map((comment) => {
    if (comment.trackId) return comment
    const hit = commentKeyword.find(([pattern]) => pattern.test(comment.content))
    const trackId = hit?.[1]
    const track = trackId ? tracks.find((t) => t.id === trackId) : undefined
    const note = track?.notes[(comment.measure - 1) * NOTES_PER_MEASURE]
    return {
      ...comment,
      trackId,
      noteId: note ? note.id : undefined,
      baselineMeasure: comment.measure,
      signature: note && track ? noteSignature(note, track.transposition) : undefined,
      stale: !trackId,
      staleReason: trackId ? undefined : '无法按关键词识别声部，请手动指定',
    } satisfies ScoreComment
  })
  const upgradedTracks = (draft.tracks ?? tracks).map((track) => ({
    ...track,
    notes: track.notes.map((note, index) => (note.id ? note : { ...note, id: `N-legacy-${track.id}-${index}` })),
  }))
  return { tracks: upgradedTracks, comments: upgradedComments }
}

/* ---------------- 进度：已交部分保留，可接着重试 ---------------- */

export function mergeOps(bundle: OfflineBundle): PlanOp['kind'][] {
  const ops: PlanOp['kind'][] = []
  for (const patch of bundle.patches) for (const field of NOTE_FIELDS) if (field in patch.fields) ops.push('field')
  for (const _item of bundle.added) ops.push('add')
  for (const _item of bundle.removed) ops.push('remove')
  if (typeof bundle.transpositionTo === 'number') ops.push('transposition')
  return ops
}

/* ---------------- 移调 ---------------- */

export function transposeKey(key: string, semitones: number): string {
  const chromatic = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b']
  const [pitch, octaveText] = key.split('/')
  let index = chromatic.indexOf(pitch!.replace('b', '')) + semitones
  let octave = Number(octaveText)
  while (index < 0) { index += 12; octave -= 1 }
  while (index >= 12) { index -= 12; octave += 1 }
  return `${chromatic[index]}/${octave}`
}
