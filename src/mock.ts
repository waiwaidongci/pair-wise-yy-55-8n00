import type { OfflineBundle, PublishingCheck, ScoreComment, ScoreNote, ScoreVersion, Track, TrackBaseline } from './types'
import { buildTrackBaseline, noteSignature } from './handoff/engine'

const notes = (keys: string[]): ScoreNote[] => keys.map((key, index) => ({ id: `N-${index + 1}`, key, duration: index % 4 === 0 ? 'h' : 'q', dynamic: index < 2 ? 'mp' : 'mf', tie: index === 2, expression: index === 3 ? 'dolce' : '' }))

const departureTracks: Track[] = [
  { id: 'TR-01', name: '长笛', instrument: 'Flute', clef: 'treble', transposition: 0, color: '#2563eb', notes: notes(['c/5','d/5','e/5','g/5','a/5','g/5','e/5','d/5','c/5','e/5','g/5','a/5']) },
  { id: 'TR-02', name: '单簧管', instrument: 'Clarinet in Bb', clef: 'treble', transposition: -2, color: '#7c3aed', notes: notes(['d/4','e/4','f/4','a/4','c/5','a/4','f/4','e/4','d/4','f/4','a/4','c/5']) },
  { id: 'TR-03', name: '圆号', instrument: 'Horn in F', clef: 'treble', transposition: -7, color: '#d97706', notes: notes(['g/3','a/3','c/4','d/4','e/4','d/4','c/4','a/3','g/3','c/4','d/4','e/4']) },
  { id: 'TR-04', name: '大提琴', instrument: 'Violoncello', clef: 'bass', transposition: 0, color: '#059669', notes: notes(['c/3','g/3','e/3','d/3','c/3','g/3','a/3','g/3','c/3','e/3','g/3','a/3']) },
]

/** 巡演出发前各声部小节基线（之后工作室的改动不写回基线） */
export const seedBaselines: TrackBaseline[] = departureTracks.map((track) => buildTrackBaseline(track, '沈青 · 出发前', '2026-09-30T09:00:00+08:00'))

/** 当前工作室总谱：指挥回来后先把圆号第 2 小节首音力度改到 f —— 与离线声部长的改动将撞车 */
export const seedTracks: Track[] = structuredClone(departureTracks).map((track) => {
  if (track.id !== 'TR-03') return track
  return { ...track, notes: track.notes.map((note, index) => (index === 4 ? { ...note, dynamic: 'f' } : note)) }
})

/** 旧格式评论：只有小节号、没有声部编号 —— 供“旧草稿先回填声部编号再升级” */
export const seedComments: ScoreComment[] = [
  { id: 'CM-1', measure: 2, author: '指挥 · 方亦', content: '圆号第 2 小节进入需再弱一级，避免覆盖大提琴主题。', resolved: false },
  { id: 'CM-2', measure: 3, author: '作曲 · 沈青', content: '第 3 小节末音增加延音线，与下一小节第一拍连奏。', resolved: false },
  { id: 'CM-3', measure: 6, author: '出版 · 赵晴', content: '单簧管分谱需在换页处保留 2 小节提示音。', resolved: true },
]

export const seedPublishingChecks: PublishingCheck[] = [
  { id: 'PC-1', label: '和弦拼写校验', kind: 'spelling', trackId: 'TR-01', status: 'pass', detail: '无等音冲突', signature: seedTracks[0]!.notes.map((n) => `${n.key}${n.accidental ?? ''}`).join(','), },
  { id: 'PC-2', label: '节奏完整性', kind: 'rhythm', trackId: 'TR-03', status: 'pass', detail: '共 3 个完整小节', signature: `ry:${seedTracks[2]!.notes.length}`, },
  { id: 'PC-3', label: '换页与提示音', kind: 'pageTurn', trackId: 'TR-02', measure: 6, status: 'pass', detail: '换页处保留 2 小节提示音', signature: 'cue:2' },
  { id: 'PC-4', label: '分谱移调同步', kind: 'transposition', trackId: 'TR-02', status: 'pass', detail: '单簧管分谱按 -2 半音与总谱同步', signature: 'tp:-2' },
  { id: 'PC-5', label: '分谱移调同步', kind: 'transposition', trackId: 'TR-03', status: 'pass', detail: '圆号分谱按 -7 半音与总谱同步', signature: 'tp:-7' },
]

/** 离线回传包 1：圆号声部长 —— N-5 力度双方都改（进复核区），其余按字段合并，另增一音、删一音 */
export const hornBundle: OfflineBundle = {
  id: 'OB-01', trackId: 'TR-03', author: '圆号声部长 · 阿古拉', device: 'iPad · 排练厅', createdAt: '2026-10-01T11:20:00+08:00',
  baselineId: seedBaselines[2]!.id, transpositionFrom: -7,
  patches: [
    { noteId: 'N-5', base: { dynamic: 'mf' }, fields: { dynamic: 'p' } },
    { noteId: 'N-6', base: { dynamic: 'mf' }, fields: { dynamic: 'mp' } },
    { noteId: 'N-7', base: { key: 'd/4' }, fields: { key: 'e/4' } },
  ],
  added: [{ note: { id: 'N-101', key: 'd/4', duration: '8', dynamic: 'mp', tie: false, expression: '' }, afterNoteId: 'N-8' }],
  removed: [{ noteId: 'N-12', contentSignature: noteSignature(departureTracks[2]!.notes[11]!, -7) }],
}

/** 离线回传包 2：单簧管声部长 —— 第 3 个写入操作处断网一次，已交部分保留、重试续传；并移调分谱 */
export const clarinetBundle: OfflineBundle = {
  id: 'OB-02', trackId: 'TR-02', author: '单簧管声部长 · 林澜', device: '手机 · 巡演大巴', createdAt: '2026-10-01T12:05:00+08:00',
  baselineId: seedBaselines[1]!.id, transpositionFrom: -2, transpositionTo: -5,
  patches: [
    { noteId: 'N-9', base: { expression: '' }, fields: { expression: 'cantabile' } },
    { noteId: 'N-5', base: { tie: false }, fields: { tie: true } },
  ],
  added: [],
  removed: [],
  simulateFailAt: 2,
}

export const seedBundles: OfflineBundle[] = [hornBundle, clarinetBundle]

export const seedVersions: ScoreVersion[] = [
  {
    id: 'v12', author: '沈青', time: '今天 16:28', summary: '调整终段和声，补充圆号力度与连音线', source: 'studio',
    trackNotes: Object.fromEntries(departureTracks.map((track) => [track.id, structuredClone(track.notes)])),
    trackTransposition: Object.fromEntries(departureTracks.map((track) => [track.id, track.transposition])),
    comments: structuredClone(seedComments),
    publishingChecks: structuredClone(seedPublishingChecks),
  },
  {
    id: 'v11', author: '方亦', time: '今天 14:10', summary: '移调单簧管分谱并调整换气标记', source: 'studio',
    trackNotes: Object.fromEntries(departureTracks.map((track) => [track.id, structuredClone(track.notes)])),
    trackTransposition: Object.fromEntries(departureTracks.map((track) => [track.id, track.transposition])),
    comments: structuredClone(seedComments),
    publishingChecks: structuredClone(seedPublishingChecks),
  },
]
