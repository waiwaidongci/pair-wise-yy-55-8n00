import { Alert, Button, Card, Col, Empty, Progress, Row, Space, Statistic, Tag, Timeline, Tooltip } from 'antd'
import {
  CheckCircleOutlined, CloudUploadOutlined, WarningOutlined,
  FileProtectOutlined, RetweetOutlined, RocketOutlined,
} from '@ant-design/icons'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../store'
import { acceptHandoff, decideReview, migrateOldDraft, rebuildBaselines, resetHandoff, writeNextOp } from '../store'
import type { BundleProgress, OfflineBundle, ReviewItem } from '../types'

const statusMeta: Record<BundleProgress['status'], { color: string; text: string }> = {
  queued: { color: 'default', text: '排队' },
  merging: { color: 'processing', text: '写入中' },
  review: { color: 'warning', text: '待复核' },
  completed: { color: 'success', text: '已完成' },
  failed: { color: 'error', text: '写入失败' },
}

const kindText: Record<ReviewItem['kind'], string> = {
  'note-field': '音符字段冲突', transposition: '移调冲突', 'note-removed': '删除冲突', 'note-missing': '音符缺失',
}

function valueText(value: unknown) {
  if (value === undefined || value === '') return '（空）'
  if (value === true) return '是'
  if (value === false) return '否'
  return String(value)
}

export default function Handoff() {
  const dispatch = useDispatch<AppDispatch>()
  const { inbox, progress, plans, review, baselines, logs, comments, publishingChecks, versions, draftMigrated, tracks } = useSelector((state: RootState) => state.score)
  const staleComments = comments.filter((c) => c.stale && !c.resolved)
  const recalculated = publishingChecks.filter((c) => c.recalculated)

  return <main className="page">
    <div className="page-head">
      <div>
        <p className="eyebrow">巡演离线改稿 · 勘误交接</p>
        <h1>回传改稿交接台</h1>
        <p>出发前留小节基线，回传后按音符标识与字段三方合并；双方都动过的进复核区；写入失败保留已交部分、断点重试；完成声部只形成一次版本。</p>
      </div>
      <Space>
        <Tooltip title="清空已交接状态，回到两个离线包刚回传时"><Button icon={<RetweetOutlined />} onClick={() => dispatch(resetHandoff())}>重置演示</Button></Tooltip>
        <Button icon={<RocketOutlined />} onClick={() => dispatch(rebuildBaselines())}>按当前稿重建出发基线</Button>
      </Space>
    </div>

    <Row gutter={[14, 14]} className="metrics">
      <Col xs={12} xl={6}><Card className="metric"><Statistic title="待交接回传包" value={inbox.length} suffix={`/ ${inbox.length + progress.length}`} prefix={<CloudUploadOutlined />} /></Card></Col>
      <Col xs={12} xl={6}><Card className="metric"><Statistic title="复核区待决" value={review.filter((r) => r.status === 'pending').length} valueStyle={{ color: '#d97706' }} prefix={<WarningOutlined />} /></Card></Col>
      <Col xs={12} xl={6}><Card className="metric"><Statistic title="失效待重算评论" value={staleComments.length} valueStyle={{ color: '#dc2626' }} prefix={<FileProtectOutlined />} /></Card></Col>
      <Col xs={12} xl={6}><Card className="metric"><Statistic title="交接形成版本" value={versions.filter((v) => v.source === 'handoff').length} valueStyle={{ color: '#059669' }} prefix={<CheckCircleOutlined />} /></Card></Col>
    </Row>

    {!draftMigrated && (
      <Alert
        type="warning" showIcon style={{ marginBottom: 16 }}
        message="检测到巡演前的旧格式草稿：评论只有小节号、没有声部编号"
        description="升级时先按内容回填声部编号、音符标识与内容指纹，再纳入本次勘误合并；识别不出声部的评论会保留为待人工指派。"
        action={<Button type="primary" onClick={() => dispatch(migrateOldDraft())}>回填声部编号并升级旧草稿</Button>}
      />
    )}
    {draftMigrated && (
      <Alert type="success" showIcon style={{ marginBottom: 16 }} message="旧草稿已升级：评论已回填声部编号与音符标识，锚点跟随音符而非小节序号。" />
    )}

    <Row gutter={[16, 16]}>
      <Col xs={24} xl={14}>
        <Card title={`待交接离线包（${inbox.length}）`} size="small" style={{ marginBottom: 16 }}
          extra={<Tag>绝不整包覆盖</Tag>}>
          {inbox.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="全部离线包已开始交接" /> : (
            <Space direction="vertical" style={{ width: '100%' }}>
              {inbox.map((bundle) => <InboxCard key={bundle.id} bundle={bundle} baselineMeasureCount={baselines.find((b) => b.trackId === bundle.trackId)?.measures.length ?? 0} onAccept={() => dispatch(acceptHandoff(bundle.id))} />)}
            </Space>
          )}
        </Card>

        <Card title={`写入进度（失败保留已交部分，可接着重试）`} size="small" style={{ marginBottom: 16 }}>
          {progress.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未开始写入" /> : (
            <Space direction="vertical" style={{ width: '100%' }}>
              {progress.map((item) => {
                const ops = plans[item.bundleId] ?? []
                const meta = statusMeta[item.status]
                const percent = item.totalOps ? Math.round((item.cursor / item.totalOps) * 100) : 100
                return <div key={item.bundleId} className="handoff-progress">
                  <div className="handoff-progress-head">
                    <b>{item.author}</b>
                    <Space size={6}>
                      <Tag color={meta.color}>{meta.text}</Tag>
                      {item.versionId && <Tag color="green">已形成 {item.versionId}</Tag>}
                      <Tag>第 {item.attempts} 次尝试</Tag>
                    </Space>
                  </div>
                  <Progress percent={percent} size="small" status={item.status === 'failed' ? 'exception' : item.status === 'completed' ? 'success' : 'active'} format={() => `${item.cursor} / ${item.totalOps} 项已落盘`} />
                  {item.error && <Alert type="error" showIcon style={{ padding: '4px 10px', margin: '4px 0' }} message={item.error} />}
                  <Space>
                    {item.status === 'failed' && <Button type="primary" danger icon={<RetweetOutlined />} onClick={() => dispatch(writeNextOp({ bundleId: item.bundleId }))}>从第 {item.cursor + 1} 项接着重试</Button>}
                    {item.status === 'merging' && <Button type="primary" onClick={() => dispatch(writeNextOp({ bundleId: item.bundleId }))}>写入下一项</Button>}
                    {item.status === 'review' && <Tag color="orange">自动写入完成，等待下方复核裁决后才形成版本</Tag>}
                    {item.status === 'completed' && <Tag color="green">完成声部未重复产生版本（versionId={item.versionId}）</Tag>}
                  </Space>
                  <div className="op-strip">
                    {ops.map((op, index) => <Tag key={index} color={index < item.cursor ? 'green' : index === item.cursor && item.status === 'failed' ? 'red' : 'default'}>
                      {index + 1}. {op.kind === 'field' ? `${op.noteId}·${op.field}` : op.kind === 'add' ? `+${op.note.id}` : op.kind === 'remove' ? `-${op.noteId}` : `移调→${op.to}`}
                    </Tag>)}
                  </div>
                </div>
              })}
            </Space>
          )}
        </Card>

        <Card title={`复核区 · 双方都动过的内容（${review.filter((r) => r.status === 'pending').length} 待决）`} size="small">
          {review.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无冲突：离线侧的改动都能直接按字段合并" /> : (
            <Space direction="vertical" style={{ width: '100%' }}>
              {review.map((item) => <ReviewRow key={item.id} item={item}
                onAccept={() => dispatch(decideReview({ reviewId: item.id, accept: true }))}
                onReject={() => dispatch(decideReview({ reviewId: item.id, accept: false }))} />)}
            </Space>
          )}
        </Card>
      </Col>

      <Col xs={24} xl={10}>
        <Card title="出发前各声部小节基线" size="small" style={{ marginBottom: 16 }}>
          <div className="baseline-grid">
            {baselines.map((baseline) => {
              const track = tracks.find((t) => t.id === baseline.trackId)
              return <div key={baseline.id} className="baseline-item">
                <b>{track?.name ?? baseline.trackId}</b>
                <small>{baseline.author} · {baseline.measures.length} 小节基线</small>
                <div className="baseline-measures">
                  {baseline.measures.map((m) => <Tag key={m.measure} color="blue">第 {m.measure} 小节 · {m.noteIds.length} 音 · {m.transposition >= 0 ? '+' : ''}{m.transposition}</Tag>)}
                </div>
              </div>
            })}
          </div>
        </Card>

        <Card title="失效重算联动" size="small" style={{ marginBottom: 16 }}>
          <p className="muted">音符或移调一变，锚定评论与对应出版检查立即失效重算；旧评论不删除，只标记 stale 等待确认。</p>
          <h4>评论（{staleComments.length} 失效）</h4>
          {comments.map((c) => <div key={c.id} className="invalidate-row">
            <Tag color={c.resolved ? 'green' : c.stale ? 'red' : 'blue'}>{c.resolved ? '已解决' : c.stale ? '失效待确认' : '有效'}</Tag>
            <span>{c.trackId ? `[${tracks.find((t) => t.id === c.trackId)?.name}] ` : '[无声部]'}第 {c.measure} 小节{c.noteId ? ` · ${c.noteId}` : ''} · {c.content.slice(0, 16)}…</span>
            {c.stale && !c.resolved && <small className="stale-reason">{c.staleReason}</small>}
          </div>)}
          <h4 style={{ marginTop: 12 }}>出版检查（{recalculated.length} 项已重算）</h4>
          {publishingChecks.map((check) => <div key={check.id} className="invalidate-row">
            <Tag color={check.status === 'pass' ? 'green' : 'red'}>{check.status === 'pass' ? '通过' : '不通过'}</Tag>
            <span>{check.label}（{tracks.find((t) => t.id === check.trackId)?.name}）{check.recalculated ? ' · 已重算' : ''}</span>
            <small className="stale-reason">{check.detail}</small>
          </div>)}
        </Card>

        <Card title="交接日志" size="small">
          <Timeline items={logs.slice(0, 12).map((entry) => ({ color: entry.tone === 'error' ? 'red' : entry.tone === 'warn' ? 'orange' : entry.tone === 'success' ? 'green' : 'blue', children: <span><small style={{ color: '#94a3b8' }}>{entry.time}</small> {entry.text}</span> }))} />
        </Card>
      </Col>
    </Row>
  </main>
}

function InboxCard({ bundle, baselineMeasureCount, onAccept }: { bundle: OfflineBundle; baselineMeasureCount: number; onAccept: () => void }) {
  const fieldCount = bundle.patches.reduce((sum, p) => sum + Object.keys(p.fields).length, 0)
  return <Card size="small" className="inbox-card">
    <div className="inbox-head">
      <div><b>{bundle.author}</b><div className="muted">{bundle.device} · {new Date(bundle.createdAt).toLocaleString('zh-CN', { hour12: false })} · 基线 {bundle.baselineId}（{baselineMeasureCount} 小节）</div></div>
      <Button type="primary" onClick={onAccept}>开始按标识合并</Button>
    </div>
    <Space size={6} wrap>
      <Tag color="blue">{fieldCount} 个字段改动</Tag>
      <Tag color="geekblue">{bundle.added.length} 个新增音</Tag>
      <Tag color="volcano">{bundle.removed.length} 个删除音</Tag>
      {typeof bundle.transpositionTo === 'number' && <Tag color="purple">分谱移调 {bundle.transpositionFrom} → {bundle.transpositionTo}</Tag>}
      {typeof bundle.simulateFailAt === 'number' && <Tag color="red">第 {bundle.simulateFailAt + 1} 项写入将断网一次</Tag>}
    </Space>
  </Card>
}

function ReviewRow({ item, onAccept, onReject }: { item: ReviewItem; onAccept: () => void; onReject: () => void }) {
  const decided = item.status !== 'pending'
  return <div className={`review-row ${decided ? 'decided' : ''}`}>
    <div className="review-main">
      <Space size={6} wrap><Tag color={item.kind === 'transposition' ? 'purple' : 'red'}>{kindText[item.kind]}</Tag><b>{item.label}</b>
        {decided && <Tag color={item.status === 'accepted' ? 'green' : 'default'}>{item.status === 'accepted' ? '已采用离线值' : '已保留工作室值'}</Tag>}
      </Space>
      <p className="muted" style={{ margin: '4px 0' }}>{item.reason}</p>
      {item.kind !== 'note-missing' && (
        <div className="review-values">
          <span>出发基线：<b>{valueText(item.baseValue)}</b></span>
          <span>工作室（指挥批注）：<b className="studio">{valueText(item.studioValue)}</b></span>
          <span>离线改稿：<b className="offline">{valueText(item.offlineValue)}</b></span>
        </div>
      )}
    </div>
    {!decided && <Space direction="vertical"><Button size="small" type="primary" onClick={onAccept}>采用离线值</Button><Button size="small" onClick={onReject}>保留工作室值</Button></Space>}
  </div>
}
