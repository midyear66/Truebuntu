import { BrowserRouter, Routes, Route } from 'react-router-dom'

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-100">
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-gray-800 mb-4">NAS Web UI</h1>
            <p className="text-gray-600">Phase 4 will build out the full frontend.</p>
          </div>
        </div>
      </div>
    </BrowserRouter>
  )
}

export default App
