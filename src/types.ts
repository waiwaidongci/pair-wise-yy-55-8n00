export interface ScoreNote {
  id: string
  key: string
  duration: 'q' | 'h' | '8'
  accidental?: '#' | 'b' | 'n'
  dynamic: 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff'
  tie: boolean
  expression: string
}

export interface Track {
  id: string
  name: string
  instrument: string
  clef: 'treble' | 'bass' | 'alto'
  transposition: number
  color: string
  notes: ScoreNote[]
}

export interface ScoreComment {
  id: string
  measure: number
  author: string
  content: string
  resolved: boolean
  /** 锚定声部（旧草稿可能缺失，升级时回填） */
  trackId?: string
  /** 锚定音符标识（按音符标识合并后仍可对齐） */
  noteId?: string
  /** 音符或移调变更后标记失效，待重算 */
  invalidated?: boolean
  /** 锚点音符已不存在，重算后标记孤儿 */
  orphaned?: boolean
}

export interface VersionMeta {
  /** 勘误交接来源的回传包裹 id，用于幂等控制（完成声部不重复形成版本） */
  submissionId?: string
  trackId?: string
  source: 'handoff' | 'manual'
}

export interface ScoreVersion {
  id: string
  author: string
  time: string
  summary: string
  trackNotes: Record<string, ScoreNote[]>
  meta?: VersionMeta
}

/** 出发前留存的声部小节基线 */
export interface Baseline {
  id: string
  trackId: string
  trackName: string
  transposition: number
  notes: ScoreNote[]
  measures: number
  createdAt: string
}

/** 离线回传的单字段修改：按音符标识 + 字段提交，不整包覆盖 */
export interface NoteEdit {
  id: string
  noteId: string
  measure: number
  field: 'key' | 'duration' | 'dynamic' | 'tie' | 'expression' | 'transposition'
  oldValue: unknown
  newValue: unknown
  reason?: string
}

export type SubmissionStatus = 'pending' | 'merging' | 'review' | 'partial' | 'done'

/** 声部长离线回传包裹 */
export interface OfflineSubmission {
  id: string
  from: string
  trackId: string
  trackName: string
  receivedAt: string
  status: SubmissionStatus
  edits: NoteEdit[]
  /** 已成功写入的字段修改 id（断点续传依据） */
  appliedEditIds: string[]
  reviewItemIds: string[]
  error?: string
  versionId?: string
  attempts: number
}

/** 双方都动过的字段进入复核区 */
export interface ReviewItem {
  id: string
  submissionId: string
  trackId: string
  noteId: string
  measure: number
  field: NoteEdit['field']
  baseValue: unknown
  studioValue: unknown
  offlineValue: unknown
  status: 'pending' | 'studio' | 'offline'
}

/** 出版检查项：音符或移调变更后失效，需重算 */
export interface PublishCheck {
  id: string
  label: string
  status: 'pass' | 'fail'
  stale: boolean
  detail: string
}
