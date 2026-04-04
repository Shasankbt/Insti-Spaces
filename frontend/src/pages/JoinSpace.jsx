// pages/JoinSpace.jsx
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import axios from 'axios'

export default function JoinSpace() {
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState('loading') // loading | success | error
  const [message, setMessage] = useState('')
  const { user, loading, token } = useAuth()
  const navigate = useNavigate()

  const inviteToken = searchParams.get('token')  // reads ?token=xxx from URL

  useEffect(() => {
    if (loading) return
    if (!user) {
      // not logged in, send to login and come back after
      navigate(`/login?redirect=${encodeURIComponent(`/spaces/join?token=${inviteToken}`)}`)
      return
    }
    if (!inviteToken) {
      setStatus('error')
      setMessage('Invalid invite link')
      return
    }

    // hit the backend to join
    axios.post(`http://localhost:3000/spaces/join-via-link`, { token: inviteToken }, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => {
        setStatus('success')
        setMessage(res.data.spaceName)
      })
      .catch(err => {
        setStatus('error')
        setMessage(err.response?.data?.error || 'Invalid or expired invite link')
      })
  }, [loading, user, token, inviteToken])

  if (status === 'loading') return <p>Joining space...</p>
  if (status === 'error') return <p style={{ color: 'red' }}>{message}</p>
  if (status === 'success') return (
    <div>
      <p>Successfully joined <strong>{message}</strong>!</p>
      <button onClick={() => navigate('/')}>Go to Home</button>
    </div>
  )
}