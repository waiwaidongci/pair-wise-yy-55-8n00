import { Alert, Button, Card, Col, Progress, Row, Table, Tag } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useSelector } from 'react-redux'
import type { RootState } from '../store'
import { scoreApi } from '../store'

export default function Overview() {
  const navigate = useNavigate()
  const { tracks, comments, review, inbox, publishingChecks, versions } = useSelector((state: RootState) => state.score)
  const { data } = scoreApi.endpoints.getPublishingProfile.useQuery()
  const measureCount = Math.max(...tracks.map((t) => Math.ceil(t.notes.length / 4)))
  const pendingReview = review.filter((item) => item.status === 'pending').length
  const recalc = publishingChecks.filter((c) => c.recalculated)
  const failed = publishingChecks.filter((c) => c.status === 'fail')
  const handoffVersions = versions.filter((v) => v.source === 'handoff')
  void data
  return <main className="page">
    <div className="page-head"><div><p className="eyebrow">乐谱、移调与出版准备</p><h1>{'《潮汐线》室内交响作品'}</h1><p>统一管理多声部总谱、移调乐器分谱、换页提示、版本差异、评论锚点与巡演勘误交接。</p></div><Button type="primary" onClick={() => navigate('/handoff')}>进入勘误交接</Button></div>
    <Row gutter={[14,14]} className="metrics"><Col xs={24} sm={12} xl={6}><Card className="metric"><span>声部数量</span><strong>{tracks.length}</strong><small>{tracks.length} 个乐手分谱</small></Card></Col><Col xs={24} sm={12} xl={6}><Card className="metric"><span>总谱小节</span><strong>{measureCount}</strong><small>4/4 拍 · C 大调</small></Card></Col><Col xs={24} sm={12} xl={6}><Card className="metric"><span>待交接 / 待复核</span><strong>{inbox.length} / {pendingReview}</strong><small>离线回传包 / 双方冲突</small></Card></Col><Col xs={24} sm={12} xl={6}><Card className="metric"><span>交接版本</span><strong>{handoffVersions.length}</strong><small>最新 {versions[0]?.id ?? '—'}</small></Card></Col></Row>
    <Alert
      type={pendingReview || inbox.length ? 'warning' : 'success'} showIcon
      message={pendingReview ? `${pendingReview} 项双方改动进入复核区，裁决后才形成版本` : inbox.length ? `${inbox.length} 个离线改稿包待按音符标识合并` : '离线改稿已全部交接，完成声部均已形成版本'}
      description="按音符标识与字段合并，不做整包覆盖；写入失败保留已交部分，可断点重试；同一声部不会重复产生版本。"
      action={<Button size="small" onClick={() => navigate('/handoff')}>{pendingReview ? '前往复核' : '查看交接'}</Button>} style={{ marginBottom: 16 }}
    />
    <Row gutter={[16,16]}><Col xs={24} xl={16}><Card title="声部与出版状态"><Table rowKey="id" pagination={false} dataSource={tracks} columns={[{title:'声部',dataIndex:'name'},{title:'乐器',dataIndex:'instrument'},{title:'移调',render:(_value,row)=><Tag color={row.transposition ? 'purple' : 'blue'}>{row.transposition ? `${row.transposition > 0 ? '+' : ''}${row.transposition} 半音` : '不移调'}</Tag>},{title:'音符',render:(_value,row)=>`${row.notes.length} 音 / ${Math.ceil(row.notes.length / 4)} 小节`},{title:'状态',render:(_value,row)=>{
      const fail = publishingChecks.find((c) => c.trackId === row.id && c.status === 'fail')
      return fail ? <Tag color="red">检查不通过</Tag> : <Tag color="green">可排版</Tag>
    }}]} /></Card></Col><Col xs={24} xl={8}><Card title="出版检查">
      {publishingChecks.map((check) => <div className="check-row" key={check.id}><span>{check.label}{check.recalculated ? '（已重算）' : ''}</span><b className={check.status === 'pass' ? 'success' : 'danger'}>{check.status === 'pass' ? '通过' : '不通过'}</b></div>)}
      <Progress percent={failed.length ? Math.round(((publishingChecks.length - failed.length) / publishingChecks.length) * 100) : 100} strokeColor={failed.length ? '#dc2626' : '#2563eb'} />
      <p className="muted">待处理评论 {comments.filter((item) => !item.resolved).length} 条；音符或移调一变，{recalc.length || 0} 项检查已自动重算。</p>
    </Card></Col></Row>
  </main>
}
