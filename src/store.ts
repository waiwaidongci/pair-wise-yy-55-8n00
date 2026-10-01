import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react'
import type { Baseline, NoteEdit, OfflineSubmission, PublishCheck, ReviewItem, ScoreComment, ScoreNote, ScoreVersion, Track } from './types'
import { seedComments, seedTracks, seedVersions } from './mock'
import { migrateDraft } from './migration'

interface ScoreState {
  tracks: Track[]
  selectedTrackId: string
  selectedNoteIndex: number
  history: string[]
  future: string[]
  comments: ScoreComment[]
  versions: ScoreVersion[]
  dirty: boolean
  /** 出发前各声部小节基线 */
  baselines: Baseline[]
  /** 声部长离线回传包裹 */
  submissions: OfflineSubmission[]
  /** 双方都动过的字段复核区 */
  reviewItems: ReviewItem[]
  /** 出版检查项（变更后失效，待重算） */
  checks: PublishCheck[]
  /** 只读查看中的旧版本 id */
  viewingVersionId: string | null
}

const seedChecks: PublishCheck[] = [
  { id: 'chord', label: '和弦拼写校验', status: 'pass', stale: false, detail: '全部和弦拼写正确' },
  { id: 'rhythm', label: '节奏完整性', status: 'pass', stale: false, detail: '各声部小节拍数完整' },
  { id: 'page-turn', label: '换页与提示音', status: 'fail', stale: false, detail: '2 项换页提示待处理' },
  { id: 'transpose', label: '分谱移调同步', status: 'pass', stale: false, detail: '移调记谱与总谱一致' },
  { id: 'anchors', label: '评论锚点', status: 'pass', stale: false, detail: '评论锚点均已对齐音符' },
  { id: 'note-ids', label: '音符标识完整性', status: 'pass', stale: false, detail: '全部音符带标识，可按字段合并' },
]

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function loadInitialState(): ScoreState {
  const base: ScoreState = {
    tracks: clone(seedTracks),
    selectedTrackId: 'TR-01',
    selectedNoteIndex: 2,
    history: [],
    future: [],
    comments: clone(seedComments),
    versions: clone(seedVersions),
    dirty: false,
    baselines: [],
    submissions: [],
    reviewItems: [],
    checks: seedChecks.map((item) => ({ ...item })),
    viewingVersionId: null,
  }
  try {
    const raw = localStorage.getItem('yy55-score-draft')
    if (raw) {
      // 旧草稿先回填声部编号与音符标识，再升级加载
      const draft = migrateDraft(JSON.parse(raw))
      base.tracks = draft.tracks
      base.comments = draft.comments
      base.versions = draft.versions
    }
  } catch {
    // 草稿损坏时忽略，使用种子数据
  }
  return base
}

function snapshot(state: ScoreState) {
  state.history.push(JSON.stringify(state.tracks))
  if (state.history.length > 40) state.history.shift()
  state.future = []
  state.dirty = true
  localStorage.setItem('yy55-score-draft', JSON.stringify({ tracks: state.tracks, comments: state.comments }))
}

function transposeKey(key: string, semitones: number) {
  const chromatic = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b']
  const [pitch, octaveText] = key.split('/')
  let index = chromatic.indexOf(pitch!.replace('b', '')) + semitones
  let octave = Number(octaveText)
  while (index < 0) { index += 12; octave -= 1 }
  while (index >= 12) { index -= 12; octave += 1 }
  return `${chromatic[index]}/${octave}`
}

function nextVersionId(state: ScoreState): string {
  const max = state.versions.reduce((m, version) => {
    const n = Number.parseInt(version.id.replace(/^v/, ''), 10)
    return Number.isFinite(n) && n > m ? n : m
  }, 12)
  return `v${max + 1}`
}

function makeBaseline(state: ScoreState, trackId: string): Baseline {
  const track = state.tracks.find((item) => item.id === trackId)!
  return {
    id: `B-${trackId}-${Date.now()}`,
    trackId,
    trackName: track.name,
    transposition: track.transposition,
    notes: clone(track.notes),
    measures: Math.ceil(track.notes.length / 4),
    createdAt: new Date().toLocaleString('zh-CN'),
  }
}

function ensureBaseline(state: ScoreState, trackId: string): Baseline {
  const existing = state.baselines.find((item) => item.trackId === trackId)
  if (existing) return existing
  const created = makeBaseline(state, trackId)
  state.baselines.push(created)
  return created
}

function fieldLabel(field: NoteEdit['field']): string {
  return { key: '音高', duration: '时值', dynamic: '力度', tie: '延音线', expression: '表情', transposition: '移调' }[field]
}

/** 音符或移调一变，对应评论与出版检查即失效，等待重算 */
function invalidate(state: ScoreState, trackId: string, kind: 'note' | 'transpose', measure?: number) {
  state.comments.forEach((comment) => {
    if (comment.trackId && comment.trackId !== trackId) return
    if (kind === 'note' && measure && comment.measure !== measure) return
    comment.invalidated = true
  })
  state.checks.forEach((check) => {
    if (kind === 'transpose' && (check.id === 'transpose' || check.id === 'anchors')) check.stale = true
    if (kind === 'note' && (check.id === 'chord' || check.id === 'rhythm' || check.id === 'anchors')) check.stale = true
  })
}

function computeCheck(id: string, state: ScoreState): PublishCheck['status'] {
  switch (id) {
    case 'anchors':
      return state.comments.some((comment) => comment.orphaned) ? 'fail' : 'pass'
    case 'note-ids':
      return state.tracks.every((track) => track.notes.every((note) => !!note.id)) ? 'pass' : 'fail'
    case 'page-turn':
      return 'fail'
    default:
      return 'pass'
  }
}

function applyEdit(note: ScoreNote, edit: NoteEdit) {
  if (edit.field === 'transposition') return
  ;(note as unknown as Record<string, unknown>)[edit.field] = edit.newValue
}

function addReview(state: ScoreState, sub: OfflineSubmission, edit: NoteEdit, baseValue: unknown, studioValue: unknown) {
  const id = `R-${sub.id}-${edit.id}`
  if (state.reviewItems.some((item) => item.id === id)) return
  state.reviewItems.push({
    id,
    submissionId: sub.id,
    trackId: sub.trackId,
    noteId: edit.noteId,
    measure: edit.measure,
    field: edit.field,
    baseValue,
    studioValue,
    offlineValue: edit.newValue,
    status: 'pending',
  })
  if (!sub.reviewItemIds.includes(id)) sub.reviewItemIds.push(id)
}

/** 声部完成后形成版本；同一回传包裹只形成一次（幂等），不重复形成版本 */
function formVersion(state: ScoreState, sub: OfflineSubmission) {
  if (state.versions.some((version) => version.meta?.submissionId === sub.id)) return
  const track = state.tracks.find((item) => item.id === sub.trackId)!
  const id = nextVersionId(state)
  state.versions.unshift({
    id,
    author: sub.from,
    time: sub.receivedAt,
    summary: `勘误交接 · ${track.name} 回传 ${sub.edits.length} 项字段修改`,
    trackNotes: { [track.id]: clone(track.notes) },
    meta: { submissionId: sub.id, trackId: track.id, source: 'handoff' },
  })
  sub.versionId = id
}

const scoreSlice = createSlice({
  name: 'score',
  initialState: loadInitialState(),
  reducers: {
    selectTrack(state, action: PayloadAction<string>) { state.selectedTrackId = action.payload; state.selectedNoteIndex = 0 },
    selectNote(state, action: PayloadAction<number>) { state.selectedNoteIndex = action.payload },
    addNote(state) {
      snapshot(state)
      const track = state.tracks.find((item) => item.id === state.selectedTrackId)!
      const template = track.notes[Math.min(track.notes.length - 1, state.selectedNoteIndex)]
      track.notes.splice(state.selectedNoteIndex + 1, 0, { id: `N-${Date.now()}`, key: template?.key ?? 'c/4', duration: 'q', dynamic: template?.dynamic ?? 'mp', tie: false, expression: '' })
      state.selectedNoteIndex += 1
    },
    removeNote(state) {
      snapshot(state)
      const track = state.tracks.find((item) => item.id === state.selectedTrackId)!
      const removedMeasure = Math.floor(state.selectedNoteIndex / 4) + 1
      if (track.notes.length > 1) track.notes.splice(state.selectedNoteIndex, 1)
      state.selectedNoteIndex = Math.max(0, state.selectedNoteIndex - 1)
      invalidate(state, track.id, 'note', removedMeasure)
    },
    updateNote(state, action: PayloadAction<Partial<ScoreNote>>) {
      snapshot(state)
      const track = state.tracks.find((item) => item.id === state.selectedTrackId)!
      const measure = Math.floor(state.selectedNoteIndex / 4) + 1
      Object.assign(track.notes[state.selectedNoteIndex]!, action.payload)
      invalidate(state, track.id, 'note', measure)
    },
    transposeTrack(state, action: PayloadAction<number>) {
      snapshot(state)
      const track = state.tracks.find((item) => item.id === state.selectedTrackId)!
      track.notes.forEach((note) => { note.key = transposeKey(note.key, action.payload) })
      track.transposition += action.payload
      invalidate(state, track.id, 'transpose')
    },
    undo(state) {
      const previous = state.history.pop()
      if (!previous) return
      state.future.push(JSON.stringify(state.tracks))
      state.tracks = JSON.parse(previous)
      state.dirty = true
    },
    redo(state) {
      const next = state.future.pop()
      if (!next) return
      state.history.push(JSON.stringify(state.tracks))
      state.tracks = JSON.parse(next)
      state.dirty = true
    },
    resolveComment(state, action: PayloadAction<string>) {
      const comment = state.comments.find((item) => item.id === action.payload)
      if (comment) comment.resolved = true
      state.dirty = true
    },
    saveVersion(state) {
      const id = nextVersionId(state)
      state.versions.unshift({
        id,
        author: '当前用户',
        time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
        summary: '保存当前总谱与分谱调整',
        trackNotes: Object.fromEntries(state.tracks.map((track) => [track.id, clone(track.notes)])),
        meta: { source: 'manual' },
      })
      state.dirty = false
      localStorage.removeItem('yy55-score-draft')
    },
    restoreDraft(state) {
      const raw = localStorage.getItem('yy55-score-draft')
      if (!raw) return
      // 旧草稿先回填声部编号与音符标识，再升级加载
      const draft = migrateDraft(JSON.parse(raw))
      state.tracks = draft.tracks
      state.comments = draft.comments
      state.versions = draft.versions
      state.dirty = true
    },
    /** 出发前为每个声部留存小节基线 */
    createBaselines(state) {
      state.baselines = state.tracks.map((track) => makeBaseline(state, track.id))
    },
    /** 登记一个离线回传包裹 */
    addSubmission(state, action: PayloadAction<OfflineSubmission>) {
      state.submissions.unshift(action.payload)
    },
    /**
     * 按音符标识 + 字段合并回传包裹。
     * 仅合并离线方改动且工作室未动过的字段；双方都动过的字段进复核区。
     * 写入失败时保留已交部分（appliedEditIds），状态置 partial，可再次调用断点续传。
     */
    mergeSubmission(state, action: PayloadAction<string>) {
      const sub = state.submissions.find((item) => item.id === action.payload)
      if (!sub || sub.status === 'done' || sub.status === 'merging') return
      sub.status = 'merging'
      sub.error = undefined
      const baseline = ensureBaseline(state, sub.trackId)
      const track = state.tracks.find((item) => item.id === sub.trackId)!
      const pending = sub.edits.filter((edit) => !sub.appliedEditIds.includes(edit.id))
      let failedIndex = -1
      for (let i = 0; i < pending.length; i++) {
        const edit = pending[i]!
        // 模拟离线写入：首次尝试在第 3 个字段写入时失败，已交部分保留
        if (sub.attempts === 0 && i === 2) { failedIndex = i; break }
        if (edit.field === 'transposition') {
          if (track.transposition !== baseline.transposition) {
            addReview(state, sub, edit, baseline.transposition, track.transposition)
          } else {
            track.transposition = edit.newValue as number
            sub.appliedEditIds.push(edit.id)
            invalidate(state, sub.trackId, 'transpose')
          }
        } else {
          const note = track.notes.find((item) => item.id === edit.noteId)
          const baseNote = baseline.notes.find((item) => item.id === edit.noteId)
          if (!note) {
            addReview(state, sub, edit, baseNote ? (baseNote as unknown as Record<string, unknown>)[edit.field] : '（基线无此音）', '（音符已删除）')
          } else if (!baseNote) {
            applyEdit(note, edit)
            sub.appliedEditIds.push(edit.id)
            invalidate(state, sub.trackId, 'note', edit.measure)
          } else {
            const baseValue = (baseNote as unknown as Record<string, unknown>)[edit.field]
            const studioValue = (note as unknown as Record<string, unknown>)[edit.field]
            if (studioValue !== baseValue) {
              addReview(state, sub, edit, baseValue, studioValue)
            } else {
              applyEdit(note, edit)
              sub.appliedEditIds.push(edit.id)
              invalidate(state, sub.trackId, 'note', edit.measure)
            }
          }
        }
      }
      sub.attempts += 1
      const hasReview = state.reviewItems.some((item) => item.submissionId === sub.id && item.status === 'pending')
      if (failedIndex >= 0) {
        sub.status = 'partial'
        sub.error = `模拟写入在第 ${failedIndex + 1} 个字段（${fieldLabel(pending[failedIndex]!.field)}）中断：已保留 ${sub.appliedEditIds.length} 项已交修改，可继续重试。`
      } else if (hasReview) {
        sub.status = 'review'
      } else {
        sub.status = 'done'
        formVersion(state, sub)
      }
      state.dirty = true
    },
    /** 复核区裁决：采用工作室现状或离线回传值 */
    resolveReview(state, action: PayloadAction<{ id: string; choice: 'studio' | 'offline' }>) {
      const item = state.reviewItems.find((review) => review.id === action.payload.id)
      if (!item || item.status !== 'pending') return
      item.status = action.payload.choice
      const sub = state.submissions.find((s) => s.id === item.submissionId)
      if (action.payload.choice === 'offline') {
        const track = state.tracks.find((t) => t.id === item.trackId)!
        if (item.field === 'transposition') {
          track.transposition = item.offlineValue as number
        } else {
          const note = track.notes.find((n) => n.id === item.noteId)
          if (note) (note as unknown as Record<string, unknown>)[item.field] = item.offlineValue
        }
        invalidate(state, item.trackId, item.field === 'transposition' ? 'transpose' : 'note', item.measure || undefined)
      }
      if (sub && sub.status === 'review') {
        const pending = state.reviewItems.some((review) => review.submissionId === sub.id && review.status === 'pending')
        if (!pending) {
          sub.status = 'done'
          formVersion(state, sub)
        }
      }
      state.dirty = true
    },
    /** 重算失效的评论锚点与出版检查 */
    recalcInvalidations(state) {
      state.comments.forEach((comment) => {
        if (!comment.invalidated && !comment.orphaned) return
        if (comment.noteId) {
          const track = state.tracks.find((item) => item.id === comment.trackId)
          const noteIndex = track?.notes.findIndex((item) => item.id === comment.noteId) ?? -1
          if (track && noteIndex >= 0) {
            comment.measure = Math.floor(noteIndex / 4) + 1
            comment.orphaned = false
          } else {
            comment.orphaned = true
          }
        }
        comment.invalidated = false
      })
      state.checks.forEach((check) => {
        check.stale = false
        check.status = computeCheck(check.id, state)
      })
    },
    /** 只读查看旧版本快照（旧版本继续可查，不覆盖现行稿） */
    viewVersion(state, action: PayloadAction<string | null>) {
      state.viewingVersionId = action.payload
    },
  },
})

export const scoreApi = createApi({
  reducerPath: 'scoreApi',
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getPublishingProfile: builder.query<{ title: string; publisher: string; pages: number; deadline: string }, void>({
      queryFn: async () => ({ data: { title: '《潮汐线》室内交响作品', publisher: '云谱出版社', pages: 46, deadline: '2026-10-12' } }),
    }),
  }),
})

export const {
  selectTrack, selectNote, addNote, removeNote, updateNote, transposeTrack, undo, redo,
  resolveComment, saveVersion, restoreDraft,
  createBaselines, addSubmission, mergeSubmission, resolveReview, recalcInvalidations, viewVersion,
} = scoreSlice.actions
export const store = configureStore({
  reducer: { score: scoreSlice.reducer, [scoreApi.reducerPath]: scoreApi.reducer },
  middleware: (getDefault) => getDefault().concat(scoreApi.middleware),
})
export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
