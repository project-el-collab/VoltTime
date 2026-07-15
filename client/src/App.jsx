import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { hasSupabaseConfig, supabase, supabaseConfigError } from './supabaseClient'

const initialBookings = []

const getCurrentOrigin = () => (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000')

const getCurrentAuthUserId = async () => {
  if (!hasSupabaseConfig) return null

  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (!userError && user?.id) return user.id

  const { data: { session } } = await supabase.auth.getSession()
  return session?.user?.id || null
}

const ensureProfileExists = async (userId, profileDetails = {}) => {
  if (!hasSupabaseConfig || !userId) return null

  const payload = {
    id: userId,
    email: profileDetails.email || '',
    first_name: profileDetails.first_name || 'Demo',
    last_name: profileDetails.last_name || 'User',
    role: profileDetails.role || 'co-worker',
  }

  const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' })
  if (error) throw error

  return payload
}

function App() {
  const [view, setView] = useState('register')
  const [user, setUser] = useState(null)
  const [bookings, setBookings] = useState(initialBookings)
  const [statusMessage, setStatusMessage] = useState(
    hasSupabaseConfig ? 'Create an account or sign in to continue.' : supabaseConfigError
  )
  const [form, setForm] = useState({
    username: '',
    password: '',
    firstName: '',
    lastName: '',
    place: '',
    projectName: '',
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: '',
    notes: '',
  })

  const stats = useMemo(() => ({
    total: bookings.length,
    approved: bookings.filter((b) => b.status === 'Approved').length,
    pending: bookings.filter((b) => b.status === 'Pending').length,
  }), [bookings])

  useEffect(() => {
    if (!hasSupabaseConfig) {
      setStatusMessage(supabaseConfigError)
      return
    }

    if (typeof window !== 'undefined' && window.location.hash.includes('error=')) {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      if (params.get('error') === 'access_denied') {
        setStatusMessage('Email confirmation link could not be completed. Please add your Vercel URL to Supabase Auth redirect settings and try again.')
      }
    }

    const loadBookings = async () => {
      try {
        const { data, error } = await supabase.from('bookings').select('*').order('created_at', { ascending: false })
        if (error) throw error
        if (data) {
          const mapped = data.map((booking) => ({
            id: booking.id,
            projectName: booking.project_name,
            place: booking.place,
            start: booking.start_time,
            end: booking.end_time,
            notes: booking.notes || '',
            status: booking.status || 'pending',
          }))
          setBookings(mapped)
        }
      } catch (error) {
        console.info('Bookings not yet available:', error)
      }
    }

    const syncAuthUser = async () => {
      const userId = await getCurrentAuthUserId()
      if (userId) {
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single()

        if (!profileError || profileError.code === 'PGRST116') {
          setUser({
            username: session.user.email || '',
            firstName: profileData?.first_name || 'Demo',
            lastName: profileData?.last_name || 'User',
            role: profileData?.role || 'co-worker',
            id: userId,
          })
          setView('dashboard')
        }
      }
    }

    loadBookings()
    syncAuthUser()
  }, [])

  const handleRegister = async (event) => {
    event.preventDefault()
    if (!form.username || !form.password || !form.firstName || !form.lastName) {
      setStatusMessage('Please fill all registration fields.')
      return
    }

    if (!hasSupabaseConfig) {
      setStatusMessage(supabaseConfigError)
      return
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email: form.username,
        password: form.password,
        options: {
          emailRedirectTo: getCurrentOrigin(),
        },
      })

      if (error) throw error

      const userId = data?.user?.id || data?.session?.user?.id

      if (userId) {
        await ensureProfileExists(userId, {
          email: form.username,
          first_name: form.firstName,
          last_name: form.lastName,
          role: 'co-worker',
        })
      }

      setUser({
        username: form.username,
        firstName: form.firstName,
        lastName: form.lastName,
        role: 'co-worker',
        id: userId || `local-${Date.now()}`,
      })
      setView('dashboard')
      setStatusMessage('Registration submitted. Check your Supabase auth setup for email confirmation.')
    } catch (error) {
      setStatusMessage(error.message || 'Registration failed.')
    }
  }

  const handleLogin = async (event) => {
    event.preventDefault()
    if (!form.username || !form.password) {
      setStatusMessage('Please enter your email and password.')
      return
    }

    if (!hasSupabaseConfig) {
      setStatusMessage(supabaseConfigError)
      return
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: form.username,
        password: form.password,
      })

      if (error) throw error

      const userId = data?.user?.id
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (profileError && profileError.code !== 'PGRST116') throw profileError

      if (userId) {
        await ensureProfileExists(userId, {
          email: form.username,
          first_name: profileData?.first_name || 'Demo',
          last_name: profileData?.last_name || 'User',
          role: profileData?.role || 'co-worker',
        })
      }

      setUser({
        username: form.username,
        firstName: profileData?.first_name || 'Demo',
        lastName: profileData?.last_name || 'User',
        role: profileData?.role || 'co-worker',
        id: userId || `local-${Date.now()}`,
      })
      setView('dashboard')
      setStatusMessage('Signed in successfully.')
    } catch (error) {
      setStatusMessage(error.message || 'Login failed.')
    }
  }

  const handleBooking = async (event) => {
    event.preventDefault()
    if (!form.place || !form.projectName || !form.startDate || !form.startTime || !form.endDate || !form.endTime) {
      setStatusMessage('Please fill the required booking fields.')
      return
    }

    if (!hasSupabaseConfig) {
      setStatusMessage(supabaseConfigError)
      return
    }

    try {
      const currentUserId = await getCurrentAuthUserId()

      if (!currentUserId) {
        setStatusMessage('Your session expired. Please sign in again.')
        return
      }

      const { data: userData } = await supabase.auth.getUser()
      await ensureProfileExists(currentUserId, {
        email: user?.username || userData?.user?.email || '',
        first_name: user?.firstName || 'Demo',
        last_name: user?.lastName || 'User',
        role: user?.role || 'co-worker',
      })

      const { error } = await supabase.from('bookings').insert({
        user_id: currentUserId,
        project_name: form.projectName,
        place: form.place,
        start_time: `${form.startDate} ${form.startTime}`,
        end_time: `${form.endDate} ${form.endTime}`,
        notes: form.notes,
        status: 'pending',
      })

      if (error) throw error

      const newBooking = {
        id: Date.now(),
        projectName: form.projectName,
        place: form.place,
        start: `${form.startDate} ${form.startTime}`,
        end: `${form.endDate} ${form.endTime}`,
        notes: form.notes,
        status: 'Pending',
      }

      setBookings((prev) => [newBooking, ...prev])
      setStatusMessage('Booking submitted successfully. Admin review is pending.')
      setForm((prev) => ({ ...prev, place: '', projectName: '', startDate: '', startTime: '', endDate: '', endTime: '', notes: '' }))
    } catch (error) {
      setStatusMessage(error.message || 'Booking submission failed.')
    }
  }

  const handleChange = (event) => {
    const { name, value } = event.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  return (
    <div className="app-shell">
      <header className="hero-card">
        <div>
          <p className="eyebrow">Free-tier web app</p>
          <h1>VoltTime</h1>
          <p className="hero-copy">
            A modern web app for electric co-workers to submit working hours and for admins to review them.
          </p>
          <p className="status-line">{statusMessage}</p>
        </div>
        <div className="hero-badges">
          <span>Register</span>
          <span>Book hours</span>
          <span>Admin review</span>
        </div>
      </header>

      {!user ? (
        <section className="card-grid">
          <div className="card auth-card">
            <div className="tab-row">
              <button className={view === 'register' ? 'tab active' : 'tab'} onClick={() => setView('register')}>
                Register
              </button>
              <button className={view === 'login' ? 'tab active' : 'tab'} onClick={() => setView('login')}>
                Login
              </button>
            </div>

            {view === 'register' ? (
              <form onSubmit={handleRegister} className="form-stack">
                <label>
                  Email
                  <input name="username" value={form.username} onChange={handleChange} type="email" required />
                </label>
                <label>
                  Password
                  <input name="password" value={form.password} onChange={handleChange} type="password" required />
                </label>
                <label>
                  First name
                  <input name="firstName" value={form.firstName} onChange={handleChange} required />
                </label>
                <label>
                  Last name
                  <input name="lastName" value={form.lastName} onChange={handleChange} required />
                </label>
                <button type="submit">Create account</button>
              </form>
            ) : (
              <form onSubmit={handleLogin} className="form-stack">
                <label>
                  Email
                  <input name="username" value={form.username} onChange={handleChange} type="email" required />
                </label>
                <label>
                  Password
                  <input name="password" value={form.password} onChange={handleChange} type="password" required />
                </label>
                <button type="submit">Sign in</button>
              </form>
            )}
          </div>

          <div className="card info-card">
            <h2>What this app does</h2>
            <ul>
              <li>Co-workers can register and sign in</li>
              <li>They can submit start/end times and workplace details</li>
              <li>Admins review submissions and approve or reject them</li>
              <li>Notifications and statuses update in the dashboard</li>
            </ul>
          </div>
        </section>
      ) : (
        <section className="dashboard">
          <div className="card stats-card">
            <h2>Welcome, {user.firstName}</h2>
            <div className="stats-grid">
              <div><strong>{stats.total}</strong><span>Total requests</span></div>
              <div><strong>{stats.approved}</strong><span>Approved</span></div>
              <div><strong>{stats.pending}</strong><span>Pending</span></div>
            </div>
          </div>

          <div className="card">
            <h3>Submit working hours</h3>
            <form onSubmit={handleBooking} className="form-stack">
              <div className="two-col">
                <label>
                  Start date
                  <input name="startDate" type="date" value={form.startDate} onChange={handleChange} required />
                </label>
                <label>
                  Start time
                  <input name="startTime" type="time" value={form.startTime} onChange={handleChange} required />
                </label>
              </div>
              <div className="two-col">
                <label>
                  End date
                  <input name="endDate" type="date" value={form.endDate} onChange={handleChange} required />
                </label>
                <label>
                  End time
                  <input name="endTime" type="time" value={form.endTime} onChange={handleChange} required />
                </label>
              </div>
              <label>
                Place of working
                <input name="place" value={form.place} onChange={handleChange} required />
              </label>
              <label>
                Project name
                <input name="projectName" value={form.projectName} onChange={handleChange} required />
              </label>
              <label>
                Notes
                <textarea name="notes" value={form.notes} onChange={handleChange} rows="4" />
              </label>
              <button type="submit">Submit booking</button>
            </form>
          </div>

          <div className="card">
            <h3>Recent submissions</h3>
            <ul className="booking-list">
              {bookings.map((booking) => (
                <li key={booking.id}>
                  <div>
                    <strong>{booking.projectName}</strong>
                    <p>{booking.place}</p>
                    <p>{booking.start} to {booking.end}</p>
                    <p>{booking.notes}</p>
                  </div>
                  <span className="status-pill">{booking.status}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  )
}

export default App
