import type { ScoreComment, ScoreNote, ScoreVersion, Track } from './types'

export interface MigratedDraft {
  tracks: Track[]
  comments: ScoreComment[]
  versions: ScoreVersion[]
}

const DURATIONS: ScoreNote['duration'][] = ['q', 'h', '8']
const DYNAMICS: ScoreNote['dynamic'][] = ['pp', 'p', 'mp', 'mf', 'f', 'ff']
const ACCIDENTALS: NonNullable<ScoreNote['accidental']>[] = ['#', 'b', 'n']

/**
 * 旧草稿升级：早期草稿的声部可能没有编号、音符没有标识，
 * 直接升级会导致回传合并时无法按音符标识对齐。
 * 升级前先按声部顺序回填声部编号（TR-01…），再为音符回填标识。
 */
export function migrateDraft(raw: unknown): MigratedDraft {
  const r = (raw ?? {}) as Record<string, any>

  const tracks: Track[] = Array.isArray(r.tracks)
    ? r.tracks.map((t: any, ti: number) => {
        const trackId: string = typeof t?.id === 'string' && t.id ? t.id : `TR-${String(ti + 1).padStart(2, '0')}`
        const notes: ScoreNote[] = Array.isArray(t?.notes)
          ? t.notes.map((n: any, ni: number) => {
              const noteId: string = typeof n?.id === 'string' && n.id ? n.id : `${trackId}-N${ni + 1}`
              const note: ScoreNote = {
                id: noteId,
                key: typeof n?.key === 'string' ? n.key : 'c/4',
                duration: DURATIONS.includes(n?.duration) ? n.duration : 'q',
                dynamic: DYNAMICS.includes(n?.dynamic) ? n.dynamic : 'mp',
                tie: !!n?.tie,
                expression: typeof n?.expression === 'string' ? n.expression : '',
              }
              if (ACCIDENTALS.includes(n?.accidental)) note.accidental = n.accidental
              return note
            })
          : []
        return {
          id: trackId,
          name: typeof t?.name === 'string' ? t.name : `声部 ${ti + 1}`,
          instrument: typeof t?.instrument === 'string' ? t.instrument : '',
          clef: t?.clef === 'bass' || t?.clef === 'alto' ? t.clef : 'treble',
          transposition: Number.isFinite(Number(t?.transposition)) ? Number(t.transposition) : 0,
          color: typeof t?.color === 'string' ? t.color : '#2563eb',
          notes,
        }
      })
    : []

  const comments: ScoreComment[] = Array.isArray(r.comments)
    ? r.comments.map((c: any) => ({
        id: typeof c?.id === 'string' ? c.id : `CM-${Date.now()}`,
        measure: Number.isFinite(Number(c?.measure)) ? Number(c.measure) : 1,
        author: typeof c?.author === 'string' ? c.author : '匿名',
        content: typeof c?.content === 'string' ? c.content : '',
        resolved: !!c?.resolved,
        ...(typeof c?.trackId === 'string' ? { trackId: c.trackId } : {}),
        ...(typeof c?.noteId === 'string' ? { noteId: c.noteId } : {}),
        ...(c?.invalidated ? { invalidated: true } : {}),
        ...(c?.orphaned ? { orphaned: true } : {}),
      }))
    : []

  const versions: ScoreVersion[] = Array.isArray(r.versions)
    ? r.versions.map((v: any) => ({
        id: typeof v?.id === 'string' ? v.id : `v${Date.now()}`,
        author: typeof v?.author === 'string' ? v.author : '匿名',
        time: typeof v?.time === 'string' ? v.time : '',
        summary: typeof v?.summary === 'string' ? v.summary : '',
        trackNotes: v?.trackNotes && typeof v.trackNotes === 'object' ? v.trackNotes : {},
        meta: v?.meta ?? { source: 'manual' as const },
      }))
    : []

  return { tracks, comments, versions }
}
