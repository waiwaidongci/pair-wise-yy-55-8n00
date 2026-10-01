import { useState } from 'react'
import { Button, InputNumber, Select, Space, Switch, Tag } from 'antd'
import { PrinterOutlined } from '@ant-design/icons'
import { useSelector } from 'react-redux'
import type { RootState } from '../store'

export default function Parts() {
  const tracks = useSelector((state: RootState) => state.score.tracks)
  const latestVersion = useSelector((state: RootState) => state.score.versions[0]?.id ?? 'v12')
  const [trackId, setTrackId] = useState(tracks[0]!.id)
  const [cue, setCue] = useState(true)
  const [pageTurn, setPageTurn] = useState(2)
  const track = tracks.find((item) => item.id === trackId)!
  const measureCount = Math.max(1, Math.ceil(track.notes.length / 4))
  const cueTrack = tracks[(tracks.findIndex((item) => item.id === trackId) + 1) % tracks.length]
  return <main className="page">
    <div className="page-head no-print"><div><p className="eyebrow">分谱提取与出版排版</p><h1>演奏者分谱预览</h1><p>从总谱提取独立声部，单独调整换页、提示音、排练标记与打印分页；分谱音符与移调始终由总谱合并结果驱动。</p></div><Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>打印分谱</Button></div>
    <div className="panel no-print" style={{marginBottom:16}}><Space wrap><Select value={trackId} style={{width:180}} options={tracks.map((item)=>({value:item.id,label:`${item.name} · ${item.instrument}`}))} onChange={setTrackId} /><span>换页前提示音：</span><InputNumber min={0} max={8} value={pageTurn} onChange={(value)=>setPageTurn(value ?? 0)} /><span>小节</span><Switch checked={cue} onChange={setCue} checkedChildren="显示提示音" unCheckedChildren="隐藏提示音" /><Tag color={track.transposition ? 'purple' : 'blue'}>{track.transposition ? `移调 ${track.transposition}` : '不移调'}</Tag></Space></div>
    <article className="part-page">
      <div style={{display:'flex',justifyContent:'space-between',borderBottom:'2px solid #0f172a',paddingBottom:10}}><div><h1 style={{margin:0,fontFamily:'serif'}}>{track.name}</h1><small>{track.instrument} · 移调后记谱分谱</small></div><div style={{textAlign:'right'}}><b>《潮汐线》</b><div>沈青 作品</div><div>出版稿 {latestVersion}</div></div></div>
      <div style={{display:'flex',justifyContent:'space-between',marginTop:10}}><b>I. 潮起 · ♩ = 72</b><span>1</span></div>
      {Array.from({ length: measureCount }, (_, measureIndex) => <div key={measureIndex}><div className="part-measure">{track.notes.slice(measureIndex*4, measureIndex*4+4).map((note,index)=><div key={note.id} className="part-note"><b>{note.key.replace('/', '')}</b><small style={{display:'block',color:'#64748b'}}>{note.dynamic}{note.tie ? ' ⁀' : ''}</small>{cue && index===0 && measureIndex>0 && <em style={{display:'block',fontSize:10,color:'#2563eb'}}>提示：{cueTrack.name}</em>}</div>)}</div>{measureIndex===1 && measureCount > 2 && <div style={{textAlign:'right',color:'#64748b',fontSize:12}}>换页 → 建议在第 {pageTurn+4} 小节前</div>}</div>)}
      <div style={{marginTop:30,borderTop:'1px solid #94a3b8',paddingTop:10,color:'#64748b',fontSize:11}}>© 2026 云谱出版社 · 仅限排练使用 · 禁止未授权复制</div>
    </article>
  </main>
}
