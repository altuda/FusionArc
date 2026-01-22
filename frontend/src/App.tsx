import { Routes, Route } from 'react-router-dom'
import MainLayout from './components/layout/MainLayout'
import Dashboard from './pages/Dashboard'
import FusionDetail from './pages/FusionDetail'

function App() {
  return (
    <MainLayout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/session/:sessionId" element={<Dashboard />} />
        <Route path="/session/:sessionId/fusion/:fusionId" element={<FusionDetail />} />
      </Routes>
    </MainLayout>
  )
}

export default App
