import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Home() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  // redirect to login if not logged in
  useEffect(() => {
    if (!user) navigate('/login')
  }, [user])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  if (!user) return null  // avoid flash before redirect

  return (
    <div>
      <h2>Hey {user.username} 👋</h2>
      <button onClick={handleLogout}>Logout</button>
    </div>
  )
}