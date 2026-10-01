import { Card, Button, Tag, Tabs, Timeline, Alert, Table } from 'antd'
import { CheckOutlined, CommentOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../store'
import { confirmStaleComment, resolveComment } from '../store'
import type { ScoreVersion } from '../types'

export default function Versions() {
  const dispatch = useDispatch<AppDispatch>()
  const { versions, comments, publishingChecks, tracks } = useSelector((state: RootState) => state.score)
  const trackName = (id?: string) => tracks.find((t) => t.id === id)?.name ?? id ?? '全声部'

  return <main className="page">
    <div className="page-head"><div><p className="eyebrow">版本、评论与出版基线</p><h1>差异比较与审阅</h1><p>交接完成的声部形成不可变快照版本（旧版本继续可查）；评论锚定音符标识，音符或移调一变即失效重算。</p></div><Button type="primary" icon={<SafetyCertificateOutlined />}>锁定出版基线</Button></div>
    <Tabs items={[
      {
        key: 'versions', label: `版本记录 (${versions.length})`, children: (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(360px,1fr))', gap: 16 }}>
            {versions.map((version) => <VersionCard key={version.id} version={version} trackName={trackName} />)}
          </div>
        ),
      },
      {
        key: 'comments', label: `评论锚点 (${comments.filter((item) => !item.resolved).length})`, children: (
          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr .7fr', gap: 16 }}>
            <Card>
              {comments.map((comment) => <div key={comment.id} style={{ display: 'grid', gridTemplateColumns: '80px 1fr auto', gap: 12, padding: '14px 0', borderBottom: '1px solid #edf0f5' }}>
                <Tag icon={<CommentOutlined />} color={comment.stale && !comment.resolved ? 'red' : 'blue'}>第 {comment.measure} 小节</Tag>
                <div>
                  <b>{comment.author}</b> {comment.trackId && <Tag style={{ marginLeft: 6 }}>{trackName(comment.trackId)}</Tag>}
                  {comment.noteId && <Tag>{comment.noteId}</Tag>}
                  <p style={{ margin: '4px 0' }}>{comment.content}</p>
                  {comment.stale && !comment.resolved && <Alert type="warning" showIcon style={{ padding: '2px 10px' }} message={comment.staleReason ?? '锚点已失效，需要按最新音符重算'} />}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {comment.resolved ? <Tag color="green">已解决</Tag> : <>
                    {comment.stale && <Button size="small" type="primary" onClick={() => dispatch(confirmStaleComment(comment.id))}>按新音符重算确认</Button>}
                    <Button size="small" onClick={() => dispatch(resolveComment(comment.id))}>应用评论</Button>
                  </>}
                </div>
              </div>)}
            </Card>
            <Card title="锚定规则">
              <Alert type="info" showIcon message="评论锚定音符标识而非小节序号" description="增删音符导致小节移动时，批注跟着音符走并自动重算小节号；音符内容或移调变化时批注置为失效，指挥确认后刷新指纹。旧评论不删除，历史版本中仍可查。" />
            </Card>
          </div>
        ),
      },
      {
        key: 'checks', label: `出版检查 (${publishingChecks.filter((c) => c.status === 'fail').length} 不通过)`, children: (
          <Card title="出版检查（随音符/移调变化失效重算）">
            <Table rowKey="id" pagination={false} dataSource={publishingChecks} columns={[
              { title: '检查项', dataIndex: 'label' },
              { title: '声部', render: (_, row) => trackName(row.trackId) },
              { title: '状态', dataIndex: 'status', render: (value: string) => <Tag color={value === 'pass' ? 'green' : 'red'}>{value === 'pass' ? '通过' : '不通过'}</Tag> },
              { title: '重算', dataIndex: 'recalculated', render: (value: boolean) => value ? <Tag color="orange">已按新稿重算</Tag> : <Tag>未变化</Tag> },
              { title: '详情', dataIndex: 'detail' },
            ]} />
          </Card>
        ),
      },
      { key: 'timeline', label: '操作历史', children: <Card><Timeline items={versions.slice(0, 6).map((version) => ({ color: version.source === 'handoff' ? 'green' : 'blue', children: <span><b>{version.id}</b> · {version.author} · {version.time} {version.source === 'handoff' && <Tag color="green">离线交接</Tag>} {version.parentVersionId && <small>基于 {version.parentVersionId}</small>}<div>{version.summary}</div></span> }))} /></Card> },
    ]} />
  </main>
}

function VersionCard({ version, trackName }: { version: ScoreVersion; trackName: (id?: string) => string }) {
  const changedTracks = version.trackId ? [version.trackId] : Object.keys(version.trackNotes)
  return <Card
    title={<span>{version.id} · {version.author} <Tag style={{ marginLeft: 4 }}>{version.time}</Tag></span>}
    extra={<Tag color={version.source === 'handoff' ? 'green' : 'blue'}>{version.source === 'handoff' ? '离线交接版本' : '工作室版本'}</Tag>}>
    <p>{version.summary}</p>
    {version.bundleId && <p className="muted">来源回传包：{version.bundleId}{version.parentVersionId ? ` · 父版本 ${version.parentVersionId}` : ''}</p>}
    <div className="diff-row"><Tag color="red">快照</Tag><span>涉及声部：{changedTracks.map(trackName).join('、')}</span></div>
    <div className="diff-row"><Tag color="purple">移调</Tag><span>{changedTracks.map((id) => {
      const value = version.trackTransposition[id] ?? 0
      return `${trackName(id)} ${value}`
    }).join('；')}</span></div>
    <div className="diff-row"><Tag color="gold">评论</Tag><span>随版冻结 {version.comments.length} 条，其中 {version.comments.filter((c) => c.stale).length} 条在该版已失效待确认</span></div>
    <div className="diff-row"><Tag color="geekblue">检查</Tag><span>{version.publishingChecks.filter((c) => c.status === 'pass').length} 项通过 / {version.publishingChecks.filter((c) => c.status === 'fail').length} 项不通过</span></div>
    <p className="muted" style={{ marginTop: 8 }}>不可变快照：之后的合并只追加新版本，本版本随时可查、可回放。</p>
  </Card>
}
