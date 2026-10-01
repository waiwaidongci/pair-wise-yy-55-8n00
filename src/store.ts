import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react'
import type {
  BundleProgress, OfflineBundle, PublishingCheck,
  ReviewItem, ScoreComment, ScoreNote, ScoreVersion, Track, TrackBaseline,
} from './types'
import {
  seedBaselines, seedBundles, seedComments, seedPublishingChecks, seedTracks, seedVersions,
} from './mock'
import type { PlanOp } from './handoff/engine'
import {
  NOTE_FIELDS, applyOp, applyReviewDecision, buildPlan, buildTrackBaseline,
  confirmComment as recomputeCommentAnchor, measureOfNote, migrateDraft,
  opAffectedMeasures, recomputeComments, recomputePublishingChecks, transposeKey,
} from './handoff/engine'

interface ScoreState {
  tracks: Track[]
  selectedTrackId: string
  selectedNoteIndex: number
  history: string[]
  future: string[]
  comments: ScoreComment[]
  versions: ScoreVersion[]
  publishingChecks: PublishingCheck[]
  dirty: boolean
  /* 勘误交接 */
  baselines: TrackBaseline[]
  inbox: OfflineBundle[]
  progress: BundleProgress[]
  plans: Record<string, PlanOp[]>
  review: ReviewItem[]
  logs: { time: string; text: string; tone: 'info' | 'warn' | 'success' | 'error' }[]
  draftMigrated: boolean
}

const STORAGE_KEY = 'yy55-handoff-v1'
const DRAFT_KEY = 'yy55-score-draft'

interface PersistedHandoff {
  tracks: Track[]
  comments: ScoreComment[]
  publishingChecks: PublishingCheck[]
  progress: BundleProgress[]
  plans: Record<string, PlanOp[]>
  review: ReviewItem[]
  baselines: TrackBaseline[]
  draftMigrated: boolean
}

function loadPersisted(): Partial<PersistedHandoff> | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) as PersistedHandoff : undefined
  } catch { return undefined }
}

const persisted = loadPersisted()

const initialState: ScoreState = {
  tracks: persisted?.tracks ?? structuredClone(seedTracks),
  selectedTrackId: 'TR-01', selectedNoteIndex: 2, history: [], future: [],
  comments: persisted?.comments ?? structuredClone(seedComments),
  versions: structuredClone(seedVersions),
  publishingChecks: persisted?.publishingChecks ?? structuredClone(seedPublishingChecks),
  dirty: false,
  baselines: persisted?.baselines ?? structuredClone(seedBaselines),
  inbox: structuredClone(seedBundles),
  progress: persisted?.progress ?? [],
  plans: persisted?.plans ?? {},
  review: persisted?.review ?? [],
  logs: [{ time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), text: '离线改稿回传 2 包待交接，已按出发前基线就位', tone: 'info' }],
  draftMigrated: persisted?.draftMigrated ?? false,
}

function persist(state: ScoreState) {
  const data: PersistedHandoff = {
    tracks: state.tracks, comments: state.comments, publishingChecks: state.publishingChecks,
    progress: state.progress, plans: state.plans, review: state.review,
    baselines: state.baselines, draftMigrated: state.draftMigrated,
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) } catch { /* 配额失败不阻塞内存状态 */ }
}

function log(state: ScoreState, text: string, tone: ScoreState['logs'][number]['tone'] = 'info') {
  state.logs.unshift({ time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), text, tone })
  if (state.logs.length > 60) state.logs.pop()
}

function snapshot(state: ScoreState) {
  state.history.push(JSON.stringify(state.tracks)); if (state.history.length > 40) state.history.shift()
  state.future = []; state.dirty = true
  localStorage.setItem(DRAFT_KEY, JSON.stringify({ tracks: state.tracks, comments: state.comments }))
}

/** 按影响面失效重算评论与出版检查（不删除旧评论，只标记 stale） */
function recomputeFor(state: ScoreState, trackId: string, measures: number[], transpositionChanged: boolean) {
  const changed = [{ trackId, measures, transpositionChanged }]
  state.comments = recomputeComments(state.comments, state.tracks, changed)
  state.publishingChecks = recomputePublishingChecks(state.publishingChecks, state.tracks, changed)
}

/** 完成声部不重复形成版本：同一交接包只形成一次 */
function formVersionOnce(state: ScoreState, progress: BundleProgress, summary: string) {
  if (progress.versionId) return progress.versionId
  const used = new Set(state.versions.map((v) => v.id))
  const num = 13 + state.versions.filter((v) => v.source === 'handoff').length
  let id = `v${num}`
  let extra = 1
  while (used.has(id)) { extra += 1; id = `v${num}-${extra}` }
  state.versions.unshift({
    id,
    author: progress.author,
    time: new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' }),
    summary,
    source: 'handoff',
    bundleId: progress.bundleId,
    trackId: progress.trackId,
    parentVersionId: state.versions[0]?.id,
    trackNotes: Object.fromEntries(state.tracks.map((track) => [track.id, structuredClone(track.notes)])),
    trackTransposition: Object.fromEntries(state.tracks.map((track) => [track.id, track.transposition])),
    comments: structuredClone(state.comments),
    publishingChecks: structuredClone(state.publishingChecks),
  })
  progress.versionId = id
  return id
}

const scoreSlice = createSlice({
  name: 'score',
  initialState,
  reducers: {
    selectTrack(state, action: PayloadAction<string>) { state.selectedTrackId = action.payload; state.selectedNoteIndex = 0 },
    selectNote(state, action: PayloadAction<number>) { state.selectedNoteIndex = action.payload },
    addNote(state) {
      snapshot(state); const track = state.tracks.find((item) => item.id === state.selectedTrackId)!
      const template = track.notes[Math.min(track.notes.length - 1, state.selectedNoteIndex)]
      track.notes.splice(state.selectedNoteIndex + 1, 0, { id: `N-${Date.now()}`, key: template?.key ?? 'c/4', duration: 'q', dynamic: template?.dynamic ?? 'mf', tie: false, expression: '' })
      state.selectedNoteIndex += 1
      recomputeFor(state, track.id, [measureOfNote(state.selectedNoteIndex)], false)
    },
    removeNote(state) {
      snapshot(state); const track = state.tracks.find((item) => item.id === state.selectedTrackId)!
      const measure = measureOfNote(state.selectedNoteIndex)
      if (track.notes.length > 1) track.notes.splice(state.selectedNoteIndex, 1)
      state.selectedNoteIndex = Math.max(0, state.selectedNoteIndex - 1)
      recomputeFor(state, track.id, [measure], false)
    },
    updateNote(state, action: PayloadAction<Partial<ScoreNote>>) {
      snapshot(state); const track = state.tracks.find((item) => item.id === state.selectedTrackId)!
      Object.assign(track.notes[state.selectedNoteIndex]!, action.payload)
      recomputeFor(state, track.id, [measureOfNote(state.selectedNoteIndex)], false)
    },
    transposeTrack(state, action: PayloadAction<number>) {
      snapshot(state); const track = state.tracks.find((item) => item.id === state.selectedTrackId)!
      track.notes.forEach((note) => { note.key = transposeKey(note.key, action.payload) })
      track.transposition += action.payload
      recomputeFor(state, track.id, track.notes.map((_, i) => measureOfNote(i)), true)
    },
    undo(state) {
      const previous = state.history.pop(); if (!previous) return
      state.future.push(JSON.stringify(state.tracks)); state.tracks = JSON.parse(previous); state.dirty = true
    },
    redo(state) {
      const next = state.future.pop(); if (!next) return
      state.history.push(JSON.stringify(state.tracks)); state.tracks = JSON.parse(next); state.dirty = true
    },
    resolveComment(state, action: PayloadAction<string>) {
      const comment = state.comments.find((item) => item.id === action.payload)
      if (comment) comment.resolved = true
      state.dirty = true
    },
    confirmStaleComment(state, action: PayloadAction<string>) {
      const comment = state.comments.find((item) => item.id === action.payload)
      if (!comment) return
      const track = state.tracks.find((t) => t.id === comment.trackId)
      state.comments = state.comments.map((item) => (item.id === comment.id ? recomputeCommentAnchor(item, track) : item))
      log(state, `评论 ${comment.id} 已按最新音符/移调重新确认，解除失效标记`, 'success')
      persist(state)
    },
    saveVersion(state) {
      const id = formVersionOnce(state, {
        bundleId: `studio-${Date.now()}`, trackId: state.selectedTrackId, author: '当前用户',
        status: 'completed', totalOps: 0, cursor: 0, attempts: 0, updatedAt: new Date().toISOString(),
      }, '保存当前总谱与分谱调整（工作室版本）')
      state.dirty = false
      localStorage.removeItem(DRAFT_KEY)
      log(state, `形成工作室版本 ${id}（全声部快照，旧版本继续可查）`, 'success')
    },

    /* ---------- 勘误交接 ---------- */
    acceptHandoff(state, action: PayloadAction<string>) {
      const bundle = state.inbox.find((item) => item.id === action.payload)
      if (!bundle) return
      const track = state.tracks.find((item) => item.id === bundle.trackId)!
      const baseline = state.baselines.find((item) => item.trackId === bundle.trackId)
      const { ops, review } = buildPlan(track, baseline, bundle)
      state.plans[bundle.id] = ops
      state.review.push(...review)
      const existing = state.progress.find((item) => item.bundleId === bundle.id)
      const progress: BundleProgress = existing ?? {
        bundleId: bundle.id, trackId: bundle.trackId, author: bundle.author, status: 'queued',
        totalOps: ops.length, cursor: 0, attempts: 0, updatedAt: new Date().toISOString(),
      }
      progress.totalOps = ops.length
      progress.status = 'merging'
      progress.attempts += 1
      progress.error = undefined
      if (!existing) state.progress.unshift(progress)
      state.inbox = state.inbox.filter((item) => item.id !== bundle.id)
      log(state, `${bundle.author} 的改稿开始交接：${ops.length} 个写入操作，${review.length} 项双方冲突进复核区`, review.length ? 'warn' : 'info')
      persist(state)
    },

    /** 写入一项：成功则 cursor 前进；写入失败保留已交部分，等待重试 */
    writeNextOp(state, action: PayloadAction<{ bundleId: string; fail?: boolean }>) {
      const { bundleId, fail } = action.payload
      const progress = state.progress.find((item) => item.bundleId === bundleId)
      if (!progress) return
      const bundle = seedBundles.find((item) => item.id === bundleId)
      const ops = state.plans[bundleId] ?? []
      progress.updatedAt = new Date().toISOString()
      const hitBreak = !progress.breakConsumed
        && (fail || (typeof bundle?.simulateFailAt === 'number' && progress.cursor === bundle.simulateFailAt))
      if (hitBreak) {
        progress.breakConsumed = true
        progress.attempts += 1
        progress.status = 'failed'
        progress.error = '网络中断：写入未确认（前序操作已落盘保留）'
        log(state, `${progress.author} 第 ${progress.cursor + 1}/${progress.totalOps} 项写入失败，已保留前 ${progress.cursor} 项，可接着重试`, 'error')
        persist(state)
        return
      }
      const op = ops[progress.cursor]
      if (!op) {
        finalizeHandoff(state, progress)
        return
      }
      const trackIndex = state.tracks.findIndex((t) => t.id === progress.trackId)
      const before = state.tracks[trackIndex]!
      const { measures, transpositionChanged } = opAffectedMeasures(before, op)
      state.tracks[trackIndex] = applyOp(before, op)
      progress.cursor += 1
      recomputeFor(state, progress.trackId, measures, transpositionChanged)
      log(state, `${progress.author} 写入 ${progress.cursor}/${progress.totalOps}：${describeOp(op)}`, 'success')
      if (progress.cursor >= ops.length) finalizeHandoff(state, progress)
      persist(state)
    },

    decideReview(state, action: PayloadAction<{ reviewId: string; accept: boolean }>) {
      const item = state.review.find((r) => r.id === action.payload.reviewId)
      if (!item || item.status !== 'pending') return
      const trackIndex = state.tracks.findIndex((t) => t.id === item.trackId)
      const track = state.tracks[trackIndex]!
      if (action.payload.accept) {
        if (item.kind === 'transposition') {
          const to = Number(item.offlineValue)
          state.tracks[trackIndex] = { ...track, transposition: to, notes: track.notes.map((n) => ({ ...n, key: transposeKey(n.key, to - track.transposition) })) }
          recomputeFor(state, track.id, track.notes.map((_, i) => measureOfNote(i)), true)
        } else {
          const affectedIndex = track.notes.findIndex((n) => n.id === item.noteId)
          state.tracks[trackIndex] = { ...track, notes: applyReviewDecision(track.notes, item) }
          recomputeFor(state, track.id, [measureOfNote(Math.max(0, affectedIndex))], false)
        }
        item.status = 'accepted'
        log(state, `复核通过：${item.label} 采用离线改稿值`, 'success')
      } else {
        item.status = 'rejected'
        log(state, `复核驳回：${item.label} 保留工作室/指挥批注`, 'warn')
      }
      persist(state)
      // 若该包所有复核项都已裁决，则补形成版本
      const pendingForBundle = state.review.some((r) => r.bundleId === item.bundleId && r.status === 'pending')
      if (!pendingForBundle) {
        const progress = state.progress.find((p) => p.bundleId === item.bundleId)
        if (progress && progress.status === 'review') {
          const id = formVersionOnce(state, progress, `离线改稿交接完成（${track.name}，复核 ${state.review.filter((r) => r.bundleId === item.bundleId).length} 项）`)
          progress.status = 'completed'
          log(state, `${track.name}复核全部裁决，形成交接版本 ${id}`, 'success')
        }
      }
      persist(state)
    },

    /** 旧草稿：先回填声部编号、音符标识与指纹，再升级 */
    migrateOldDraft(state) {
      const raw = localStorage.getItem(DRAFT_KEY)
      const draft = raw ? JSON.parse(raw) as { tracks?: Track[]; comments?: ScoreComment[] } : {}
      const result = migrateDraft(draft, state.tracks, state.comments)
      if (draft.tracks) state.tracks = result.tracks
      state.comments = result.comments
      state.draftMigrated = true
      state.dirty = true
      log(state, `旧草稿已升级：${result.comments.filter((c) => c.trackId).length} 条评论回填声部编号与音符标识`, 'success')
      persist(state)
    },

    rebuildBaselines(state) {
      state.baselines = state.tracks.map((track) => buildTrackBaseline(track, '沈青 · 重新出发'))
      log(state, '已按当前总谱重建各声部小节基线，再次出发以此为准', 'info')
      persist(state)
    },

    resetHandoff(state) {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(DRAFT_KEY)
      state.tracks = structuredClone(seedTracks)
      state.comments = structuredClone(seedComments)
      state.publishingChecks = structuredClone(seedPublishingChecks)
      state.baselines = structuredClone(seedBaselines)
      state.inbox = structuredClone(seedBundles)
      state.progress = []
      state.plans = {}
      state.review = []
      state.draftMigrated = false
      state.dirty = false
      log(state, '演示数据已重置', 'info')
    },
  },
})

function finalizeHandoff(state: ScoreState, progress: BundleProgress) {
  const pending = state.review.some((item) => item.bundleId === progress.bundleId && item.status === 'pending')
  const track = state.tracks.find((t) => t.id === progress.trackId)!
  if (pending) {
    progress.status = 'review'
    log(state, `${track.name}自动写入全部完成，但有双方冲突待复核，暂不形成版本`, 'warn')
  } else {
    const id = formVersionOnce(state, progress, `离线改稿交接完成（${track.name}，${progress.totalOps} 项按音符标识合并）`)
    progress.status = 'completed'
    log(state, `${track.name}交接完成，形成版本 ${id}；失败重试未产生重复版本`, 'success')
  }
}

function describeOp(op: PlanOp): string {
  if (op.kind === 'field') return `${op.noteId}.${NOTE_FIELDS.includes(op.field) ? op.field : ''} → ${String(op.value)}`
  if (op.kind === 'add') return `新增音符 ${op.note.id}`
  if (op.kind === 'remove') return `删除音符 ${op.noteId}`
  return `移调 ${op.from} → ${op.to}`
}

export const scoreApi = createApi({
  reducerPath: 'scoreApi',
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getPublishingProfile: builder.query<{ title: string; publisher: string; pages: number; deadline: string }, void>({ queryFn: async () => ({ data: { title: '《潮汐线》室内交响作品', publisher: '云谱出版社', pages: 46, deadline: '2026-10-12' } }) }),
  }),
})

export const {
  selectTrack, selectNote, addNote, removeNote, updateNote, transposeTrack, undo, redo,
  resolveComment, confirmStaleComment, saveVersion,
  acceptHandoff, writeNextOp, decideReview, migrateOldDraft, rebuildBaselines, resetHandoff,
} = scoreSlice.actions
export const store = configureStore({
  reducer: { score: scoreSlice.reducer, [scoreApi.reducerPath]: scoreApi.reducer },
  middleware: (getDefault) => getDefault().concat(scoreApi.middleware),
})
export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
