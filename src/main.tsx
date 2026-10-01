import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { BrowserRouter } from 'react-router-dom'
import { App as AntdApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import { store } from './store'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Provider store={store}><ConfigProvider locale={zhCN}><AntdApp><BrowserRouter><App /></BrowserRouter></AntdApp></ConfigProvider></Provider></React.StrictMode>)
