import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Home() {
  const { user, logout, loading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!loading && !user) navigate('/login')
  }, [user, loading])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  if (loading) return <p>Loading...</p>
  if (!user) return null

  return (
    <div>
      <h2>Hey {user.username} 👋</h2>
      <button onClick={handleLogout}>Logout</button>
    </div>
  )
}