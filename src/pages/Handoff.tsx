import { useMemo, useState } from 'react'
import { Alert, App, Button, Card, Col, Descriptions, Empty, Input, Modal, Row, Select, Space, Tag, Timeline, Tooltip } from 'antd'
import {
  CheckCircleOutlined,
  CloudUploadOutlined,
  DiffOutlined,
  ReloadOutlined,
  SwapOutlined,
  ThunderboltOutlined,
  UnorderedListOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../store'
import { addSubmission, createBaselines, mergeSubmission, recalcInvalidations, resolveReview, viewVersion } from '../store'
import type { NoteEdit, OfflineSubmission, PublishCheck, SubmissionStatus, Track } from '../types'

const FIELD_LABEL: Record<NoteEdit['field'], string> = {
  key: '音高',
  duration: '时值',
  dynamic: '力度',
  tie: '延音线',
  expression: '表情',
  transposition: '移调',
}

const STATUS_META: Record<SubmissionStatus, { color: string; text: string }> = {
  pending: { color: 'default', text: '待合并' },
  merging: { color: 'processing', text: '合并中' },
  review: { color: 'error', text: '待复核' },
  partial: { color: 'warning', text: '部分写入' },
  done: { color: 'success', text: '已完成' },
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

function formatValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? '是' : '否'
  return String(value)
}

/** 模拟声部长离线回传：按音符标识 + 字段生成修改项，不整包覆盖 */
function generateSubmission(track: Track): OfflineSubmission {
  const edits: NoteEdit[] = []
  const count = 2 + Math.floor(Math.random() * 3)
  const used = new Set<number>()
  for (let i = 0; i < count; i++) {
    let idx = Math.floor(Math.random() * track.notes.length)
    while (used.has(idx)) idx = (idx + 1) % track.notes.length
    used.add(idx)
    const note = track.notes[idx]!
    const fields: NoteEdit['field'][] = ['key', 'dynamic', 'tie', 'expression', 'duration']
    const field = fields[Math.floor(Math.random() * fields.length)]!
    let newValue: unknown
    switch (field) {
      case 'key':
        newValue = transposeKey(note.key, Math.random() < 0.5 ? -1 : 1)
        break
      case 'dynamic': {
        const dyns = ['pp', 'p', 'mp', 'mf', 'f', 'ff']
        newValue = dyns[Math.floor(Math.random() * dyns.length)]
        break
      }
      case 'tie':
        newValue = !note.tie
        break
      case 'expression': {
        const exps = ['dolce', 'cantabile', 'marcato', '']
        newValue = exps[Math.floor(Math.random() * exps.length)]
        break
      }
      case 'duration': {
        const durs = ['q', 'h', '8']
        newValue = durs[Math.floor(Math.random() * durs.length)]
        break
      }
    }
    edits.push({
      id: `E-${i}-${Date.now()}`,
      noteId: note.id,
      measure: Math.floor(idx / 4) + 1,
      field,
      oldValue: (note as unknown as Record<string, unknown>)[field],
      newValue,
    })
  }
  if (Math.random() < 0.3) {
    edits.push({
      id: `E-T-${Date.now()}`,
      noteId: '',
      measure: 0,
      field: 'transposition',
      oldValue: track.transposition,
      newValue: track.transposition + (Math.random() < 0.5 ? -1 : 1),
    })
  }
  return {
    id: `S-${Date.now()}`,
    from: `声部长 · ${track.name}`,
    trackId: track.id,
    trackName: track.name,
    receivedAt: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
    status: 'pending',
    edits,
    appliedEditIds: [],
    reviewItemIds: [],
    attempts: 0,
  }
}

export default function Handoff() {
  const dispatch = useDispatch<AppDispatch>()
  const { tracks, baselines, submissions, reviewItems, checks, comments, versions, viewingVersionId } = useSelector((state: RootState) => state.score)
  const { message } = App.useApp()
  const [trackId, setTrackId] = useState(tracks[0]!.id)
  const [importText, setImportText] = useState('')
  const [importOpen, setImportOpen] = useState(false)

  const track = tracks.find((item) => item.id === trackId)!
  const pendingReviews = reviewItems.filter((item) => item.status === 'pending')
  const staleChecks = checks.filter((item) => item.stale)
  const invalidatedComments = comments.filter((item) => item.invalidated || item.orphaned)
  const viewingVersion = versions.find((item) => item.id === viewingVersionId) ?? null

  const baselineByTrack = useMemo(() => Object.fromEntries(baselines.map((b) => [b.trackId, b])), [baselines])

  const handleGenerate = () => {
    const sub = generateSubmission(track)
    dispatch(addSubmission(sub))
    message.success(`已登记 ${track.name} 的离线回传包裹（${sub.edits.length} 项字段修改）`)
  }

  const handleImport = () => {
    try {
      const raw = JSON.parse(importText) as Partial<OfflineSubmission>
      if (!raw.trackId || !Array.isArray(raw.edits)) throw new Error('bad shape')
      const target = tracks.find((item) => item.id === raw.trackId)
      if (!target) throw new Error('unknown track')
      const sub: OfflineSubmission = {
        id: raw.id ?? `S-${Date.now()}`,
        from: raw.from ?? `声部长 · ${target.name}`,
        trackId: target.id,
        trackName: target.name,
        receivedAt: raw.receivedAt ?? new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
        status: 'pending',
        edits: raw.edits,
        appliedEditIds: [],
        reviewItemIds: [],
        attempts: 0,
      }
      dispatch(addSubmission(sub))
      message.success(`已导入 ${target.name} 回传包裹（${sub.edits.length} 项字段修改）`)
      setImportOpen(false)
      setImportText('')
    } catch {
      message.error('导入失败：请粘贴合法的回传包裹 JSON（需包含 trackId 与 edits）')
    }
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">离线改稿回传 · 字段级合并 · 断点续传</p>
          <h1>勘误交接</h1>
          <p>
            出发前为各声部留存小节基线；离线改稿回传后按音符标识与字段合并，不整包覆盖；
            双方都动过的字段进入复核区；写入失败保留已交部分并可接着重试；
            声部完成后不重复形成版本；音符或移调变更即失效重算对应评论与出版检查。
          </p>
        </div>
        <Space wrap>
          <Tooltip title="重算失效的评论锚点与出版检查">
            <Button icon={<ReloadOutlined />} onClick={() => dispatch(recalcInvalidations())}>
              重算失效项{staleChecks.length + invalidatedComments.length > 0 ? `（${staleChecks.length + invalidatedComments.length}）` : ''}
            </Button>
          </Tooltip>
          <Button type="primary" icon={<ThunderboltOutlined />} onClick={() => dispatch(createBaselines())}>
            出发 · 留存小节基线
          </Button>
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        icon={<SwapOutlined />}
        message="交接流程"
        description="留存基线 → 声部长离线改稿回传 → 按音符标识与字段合并 → 双方改动进复核区 → 写入失败可断点重试 → 声部完成形成版本（同一包裹只形成一次）→ 变更失效后重算评论与出版检查。"
        style={{ marginBottom: 16 }}
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card size="small" title={<span><UnorderedListOutlined /> ① 出发基线</span>} style={{ height: '100%' }}>
            {baselines.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未留存基线：出发排练前点击右上角「留存小节基线」" />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
                {baselines.map((b) => (
                  <div key={b.id} className="handoff-baseline">
                    <b>{b.trackName}</b>
                    <small>{b.measures} 小节 · {b.notes.length} 音 · 移调 {b.transposition}</small>
                    <small className="muted">{b.createdAt}</small>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card size="small" title={<span><CloudUploadOutlined /> ② 离线回传</span>} style={{ height: '100%' }}>
            <Space wrap style={{ marginBottom: 10 }}>
              <Select value={trackId} style={{ width: 200 }} options={tracks.map((item) => ({ value: item.id, label: `${item.name} · ${item.instrument}` }))} onChange={setTrackId} />
              <Button type="primary" onClick={handleGenerate}>模拟声部长回传改稿</Button>
              <Button onClick={() => setImportOpen(true)}>导入回传包裹</Button>
            </Space>
            {baselineByTrack[trackId] ? (
              <Alert type="success" showIcon message={`${track.name} 基线已留存（${baselineByTrack[trackId]!.measures} 小节），回传后将按基线比对合并`} />
            ) : (
              <Alert type="warning" showIcon message={`${track.name} 尚未留存基线，合并时将以当前稿作为基线`} />
            )}
          </Card>
        </Col>
      </Row>

      <Card size="small" title={<span><DiffOutlined /> ③ 回传包裹与合并</span>} style={{ marginTop: 16 }}>
        {submissions.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无回传包裹" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {submissions.map((sub) => {
              const meta = STATUS_META[sub.status]
              const total = sub.edits.length
              const applied = sub.appliedEditIds.length
              const reviewCount = sub.reviewItemIds.filter((id) => reviewItems.some((r) => r.id === id && r.status === 'pending')).length
              return (
                <div key={sub.id} className="handoff-sub">
                  <div className="handoff-sub-head">
                    <Space wrap>
                      <b>{sub.from}</b>
                      <Tag>{sub.trackName}</Tag>
                      <Tag color={meta.color}>{meta.text}</Tag>
                      {sub.versionId && <Tag color="blue">已形成版本 {sub.versionId}</Tag>}
                      <span className="muted">{sub.receivedAt} · 共 {total} 项字段修改</span>
                    </Space>
                    <Space>
                      {(sub.status === 'pending' || sub.status === 'partial') && (
                        <Button size="small" type="primary" onClick={() => dispatch(mergeSubmission(sub.id))}>
                          {sub.status === 'partial' ? '继续重试' : '合并'}
                        </Button>
                      )}
                      {sub.status === 'review' && <Tag color="error">待复核 {reviewCount} 项</Tag>}
                    </Space>
                  </div>
                  <div className="handoff-progress">
                    <div className="handoff-progress-bar">
                      <div className="handoff-progress-done" style={{ width: `${total ? (applied / total) * 100 : 0}%` }} />
                    </div>
                    <small className="muted">已写入 {applied}/{total}{reviewCount > 0 ? ` · 复核 ${reviewCount}` : ''}</small>
                  </div>
                  {sub.error && <Alert type="warning" showIcon message={sub.error} style={{ marginTop: 8 }} />}
                  <div className="handoff-edits">
                    {sub.edits.map((edit) => {
                      const done = sub.appliedEditIds.includes(edit.id)
                      const inReview = reviewItems.some((r) => r.id === `R-${sub.id}-${edit.id}` && r.status === 'pending')
                      return (
                        <Tag key={edit.id} color={done ? 'green' : inReview ? 'red' : 'default'} style={{ marginBottom: 4 }}>
                          {edit.field === 'transposition' ? '移调' : `第 ${edit.measure} 小节 · ${FIELD_LABEL[edit.field]}`}
                          ：{formatValue(edit.oldValue)} → {formatValue(edit.newValue)}
                          {done ? ' ✓' : inReview ? ' ⚠ 复核中' : ''}
                        </Tag>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={14}>
          <Card
            size="small"
            title={<span><WarningOutlined /> ④ 复核区（双方都动过的字段）</span>}
            extra={pendingReviews.length > 0 ? <Tag color="error">{pendingReviews.length} 项待裁决</Tag> : undefined}
          >
            {pendingReviews.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无待复核项" />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {pendingReviews.map((item) => (
                  <div key={item.id} className="handoff-review">
                    <Space wrap>
                      <Tag color="red">{tracks.find((t) => t.id === item.trackId)?.name ?? item.trackId}</Tag>
                      <Tag>第 {item.measure} 小节</Tag>
                      <Tag color="orange">{FIELD_LABEL[item.field]}</Tag>
                    </Space>
                    <div className="handoff-diff">
                      <span>基线 <b>{formatValue(item.baseValue)}</b></span>
                      <span>工作室 <b className="danger">{formatValue(item.studioValue)}</b></span>
                      <span>离线回传 <b className="success">{formatValue(item.offlineValue)}</b></span>
                    </div>
                    <Space>
                      <Button size="small" onClick={() => dispatch(resolveReview({ id: item.id, choice: 'studio' }))}>采用工作室</Button>
                      <Button size="small" type="primary" onClick={() => dispatch(resolveReview({ id: item.id, choice: 'offline' }))}>采用离线回传</Button>
                    </Space>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card
            size="small"
            title={<span><CheckCircleOutlined /> ⑤ 出版检查与评论重算</span>}
            extra={<Button size="small" icon={<ReloadOutlined />} onClick={() => dispatch(recalcInvalidations())}>重新计算</Button>}
          >
            {invalidatedComments.length > 0 && (
              <Alert
                type="warning"
                showIcon
                message={`${invalidatedComments.length} 条评论因音符/移调变更失效，重算后按音符标识重新锚定`}
                style={{ marginBottom: 10 }}
              />
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {checks.map((check: PublishCheck) => (
                <div key={check.id} className="check-row">
                  <span>{check.label}</span>
                  <Space>
                    {check.stale && <Tag color="orange">已失效 · 待重算</Tag>}
                    <b className={check.status === 'pass' ? 'success' : 'danger'}>{check.status === 'pass' ? '通过' : '待处理'}</b>
                  </Space>
                </div>
              ))}
            </div>
          </Card>
        </Col>
      </Row>

      <Card size="small" title={<span>⑥ 版本记录（旧版本继续可查，不覆盖现行稿）</span>} style={{ marginTop: 16 }}>
        <Timeline
          items={versions.map((version) => ({
            color: version.meta?.source === 'handoff' ? 'blue' : 'gray',
            children: (
              <div className="handoff-version" onClick={() => dispatch(viewVersion(version.id))}>
                <Space wrap>
                  <b>{version.id}</b>
                  <Tag>{version.author}</Tag>
                  <span className="muted">{version.time}</span>
                  {version.meta?.source === 'handoff' && <Tag color="blue">勘误交接</Tag>}
                </Space>
                <div>{version.summary}</div>
              </div>
            ),
          }))}
        />
      </Card>

      <Modal
        title={viewingVersion ? `版本快照 ${viewingVersion.id}（只读）` : ''}
        open={!!viewingVersion}
        onCancel={() => dispatch(viewVersion(null))}
        footer={<Button onClick={() => dispatch(viewVersion(null))}>关闭</Button>}
        width={720}
      >
        {viewingVersion && (
          <div>
            <Descriptions size="small" column={2} bordered style={{ marginBottom: 12 }}>
              <Descriptions.Item label="版本号">{viewingVersion.id}</Descriptions.Item>
              <Descriptions.Item label="作者">{viewingVersion.author}</Descriptions.Item>
              <Descriptions.Item label="时间">{viewingVersion.time}</Descriptions.Item>
              <Descriptions.Item label="来源">{viewingVersion.meta?.source === 'handoff' ? '勘误交接' : '手动保存'}</Descriptions.Item>
              <Descriptions.Item label="说明" span={2}>{viewingVersion.summary}</Descriptions.Item>
            </Descriptions>
            {Object.entries(viewingVersion.trackNotes).map(([trackId, notes]) => {
              const t = tracks.find((item) => item.id === trackId)
              return (
                <Card key={trackId} size="small" title={t?.name ?? trackId} style={{ marginBottom: 8 }}>
                  <Space wrap>
                    {notes.map((note) => (
                      <Tag key={note.id}>{note.key.replace('/', '')} · {note.dynamic}{note.tie ? ' ⁀' : ''}</Tag>
                    ))}
                  </Space>
                </Card>
              )
            })}
          </div>
        )}
      </Modal>

      <Modal title="导入回传包裹" open={importOpen} onOk={handleImport} onCancel={() => setImportOpen(false)} okText="导入">
        <p className="muted">粘贴声部长离线回传的 JSON 包裹（含 trackId 与 edits 字段修改数组）。</p>
        <Input.TextArea rows={8} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder='{"trackId":"TR-01","from":"声部长 · 长笛","edits":[{"id":"E-1","noteId":"N-3","measure":1,"field":"dynamic","oldValue":"mp","newValue":"p"}]}' />
      </Modal>
    </main>
  )
}
