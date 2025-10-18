import React from 'react'
import { createRoot } from 'react-dom/client'
import './utils/axiosConfig' // Configure axios interceptors globally
import App from './App'

createRoot(document.getElementById('root')).render(<App />)
