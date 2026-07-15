import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { hasSupabaseConfig, supabase, supabaseConfigError } from './supabaseClient'

const initialBookings = []

const formatBookingStatus = (status) => {
  const value = String(status || 'Pending').toLowerCase()
  if (value === 'approved') return 'Approved'
  if (value === 'rejected') return 'Rejected'
  return 'Pending'
}

const getCurrentOrigin = () => (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000')

const getCurrentAuthUserId = async () => {
  if (!hasSupabaseConfig) return null

  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (!userError && user?.id) return user.id

  const { data: { session } } = await supabase.auth.getSession()
  return session?.user?.id || null
}

const getEffectiveRole = (email = '', setupCode = '') => {
  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL?.trim().toLowerCase() || ''
  const adminSetupCode = import.meta.env.VITE_ADMIN_SETUP_CODE?.trim() || ''

  if (adminEmail && email.toLowerCase() === adminEmail) return 'admin'
  if (adminSetupCode && setupCode && setupCode === adminSetupCode) return 'admin'
  return 'co-worker'
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

  try {
    const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' })
    if (error) {
      console.info('Profile write blocked by RLS or missing table:', error)
      return null
    }
    return payload
  } catch (error) {
    console.info('Profile write failed:', error)
    return null
  }
}

function App() {
  const [view, setView] = useState('register')
  const [user, setUser] = useState(null)
  const [bookings, setBookings] = useState(initialBookings)
  const [adminUsers, setAdminUsers] = useState([])
  const [authMode, setAuthMode] = useState('user')
  const [statusMessage, setStatusMessage] = useState(
    hasSupabaseConfig ? 'Create an account or sign in to continue.' : supabaseConfigError
  )
  const [form, setForm] = useState({
    username: '',
    password: '',
    firstName: '',
    lastName: '',
    adminSetupCode: '',
    place: '',
    projectName: '',
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: '',
    notes: '',
  })

  const [adminForm, setAdminForm] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
  })

  const stats = useMemo(() => ({
    total: bookings.length,
    approved: bookings.filter((b) => b.status === 'Approved').length,
    pending: bookings.filter((b) => b.status === 'Pending').length,
  }), [bookings])

  const loadAdminUsers = async () => {
    if (!hasSupabaseConfig) return

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, first_name, last_name, role')
        .eq('role', 'admin')
        .order('email', { ascending: true })

      if (error) throw error
      setAdminUsers(data || [])
    } catch (error) {
      console.info('Admin users not yet available:', error)
    }
  }

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

    const loadBookings = async (currentUserId, role = 'co-worker') => {
      try {
        let query = supabase.from('bookings').select('*')
        if (role !== 'admin' && currentUserId) {
          query = query.eq('user_id', currentUserId)
        }

        const { data, error } = await query.order('created_at', { ascending: false })
        if (error) throw error
        if (data) {
          const mapped = data.map((booking) => ({
            id: booking.id,
            projectName: booking.project_name,
            place: booking.place,
            start: booking.start_time,
            end: booking.end_time,
            notes: booking.notes || '',
            status: formatBookingStatus(booking.status),
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
          const role = profileData?.role || 'co-worker'
          setUser({
            username: profileData?.email || '',
            firstName: profileData?.first_name || 'Demo',
            lastName: profileData?.last_name || 'User',
            role,
            id: userId,
          })
          setView(role === 'admin' ? 'admin' : 'dashboard')
          if (role === 'admin') {
            await loadAdminUsers()
          } else {
            setAdminUsers([])
          }
          await loadBookings(userId, role)
        }
      } else {
        setBookings([])
      }
    }

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

    const role = getEffectiveRole(form.username, form.adminSetupCode)

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
          role,
        })
      }

      if (!userId) {
        setStatusMessage('Registration succeeded, but the profile write was blocked by Supabase. Please enable the profiles table policy first.')
      }

      setUser({
        username: form.username,
        firstName: form.firstName,
        lastName: form.lastName,
        role,
        id: userId || `local-${Date.now()}`,
      })
      setView(role === 'admin' ? 'admin' : 'dashboard')
      setForm((prev) => ({ ...prev, adminSetupCode: '' }))
      setStatusMessage(role === 'admin'
        ? 'Admin account created. You can now review bookings.'
        : 'Registration submitted. Check your Supabase auth setup for email confirmation.')
    } catch (error) {
      setStatusMessage(error.message || 'Registration failed.')
    }
  }

  const handleAdminLogin = async (event) => {
    event.preventDefault()
    if (!form.username || !form.password) {
      setStatusMessage('Please enter your admin email and password.')
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

      const role = profileData?.role || 'co-worker'
      if (role !== 'admin') {
        throw new Error('This account is not an admin account.')
      }

      await ensureProfileExists(userId, {
        email: form.username,
        first_name: profileData?.first_name || 'Demo',
        last_name: profileData?.last_name || 'User',
        role: 'admin',
      })

      setUser({
        username: form.username,
        firstName: profileData?.first_name || 'Demo',
        lastName: profileData?.last_name || 'User',
        role: 'admin',
        id: userId || `local-${Date.now()}`,
      })
      setAuthMode('user')
      setView('admin')
      await loadAdminUsers()
      setStatusMessage('Admin signed in successfully.')
    } catch (error) {
      setStatusMessage(error.message || 'Admin login failed.')
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
      setView(profileData?.role === 'admin' ? 'admin' : 'dashboard')
      setStatusMessage('Signed in successfully.')
    } catch (error) {
      setStatusMessage(error.message || 'Login failed.')
    }
  }

  const handleCreateAdminUser = async (event) => {
    event.preventDefault()

    if (!user?.role || user.role !== 'admin') {
      setStatusMessage('Only admin users can create other admin accounts.')
      return
    }

    if (!adminForm.email || !adminForm.password || !adminForm.firstName || !adminForm.lastName) {
      setStatusMessage('Please fill all admin creation fields.')
      return
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email: adminForm.email,
        password: adminForm.password,
        options: {
          emailRedirectTo: getCurrentOrigin(),
        },
      })

      if (error) throw error

      const newUserId = data?.user?.id || data?.session?.user?.id
      if (newUserId) {
        await ensureProfileExists(newUserId, {
          email: adminForm.email,
          first_name: adminForm.firstName,
          last_name: adminForm.lastName,
          role: 'admin',
        })
      }

      await loadAdminUsers()
      setAdminForm({ email: '', password: '', firstName: '', lastName: '' })
      setStatusMessage(`Admin account created for ${adminForm.email}.`)
    } catch (error) {
      setStatusMessage(error.message || 'Could not create admin account.')
    }
  }

  const handleResetAdminPassword = async (email) => {
    if (!email) return

    try {
      await supabase.auth.resetPasswordForEmail(email, { redirectTo: getCurrentOrigin() })
      setStatusMessage(`Password reset email sent to ${email}.`)
    } catch (error) {
      setStatusMessage(error.message || 'Could not send password reset email.')
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

  const handleBookingStatusChange = async (bookingId, nextStatus) => {
    if (!hasSupabaseConfig) {
      setStatusMessage(supabaseConfigError)
      return
    }

    try {
      const { error } = await supabase.from('bookings').update({ status: nextStatus }).eq('id', bookingId)
      if (error) throw error

      setBookings((prev) => prev.map((booking) => (
        booking.id === bookingId ? { ...booking, status: nextStatus } : booking
      )))
      setStatusMessage(`Booking marked as ${nextStatus.toLowerCase()}.`)
    } catch (error) {
      setStatusMessage(error.message || 'Could not update booking status.')
    }
  }

  const handleChange = (event) => {
    const { name, value } = event.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  const handleAdminFormChange = (event) => {
    const { name, value } = event.target
    setAdminForm((prev) => ({ ...prev, [name]: value }))
  }

  const openAdminReview = () => {
    if (user?.role === 'admin') {
      setView('admin')
      setAuthMode('user')
      return
    }

    setAuthMode('admin')
    setView('login')
    setStatusMessage('Sign in with an admin account to review bookings.')
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
          <button type="button" className="tab" onClick={openAdminReview}>Admin review</button>
        </div>
      </header>

      {!user ? (
        <section className="card-grid">
          <div className="card auth-card">
            <div className="tab-row">
              <button className={view === 'register' && authMode === 'user' ? 'tab active' : 'tab'} onClick={() => { setAuthMode('user'); setView('register') }}>
                Register
              </button>
              <button className={view === 'login' && authMode === 'user' ? 'tab active' : 'tab'} onClick={() => { setAuthMode('user'); setView('login') }}>
                Login
              </button>
              <button className={authMode === 'admin' ? 'tab active' : 'tab'} onClick={openAdminReview}>
                Admin review
              </button>
            </div>

            {authMode === 'admin' ? (
              <form onSubmit={handleAdminLogin} className="form-stack">
                <label>
                  Admin email
                  <input name="username" value={form.username} onChange={handleChange} type="email" required />
                </label>
                <label>
                  Admin password
                  <input name="password" value={form.password} onChange={handleChange} type="password" required />
                </label>
                <button type="submit">Sign in as admin</button>
              </form>
            ) : view === 'register' ? (
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
                <label>
                  Admin setup code
                  <input name="adminSetupCode" value={form.adminSetupCode} onChange={handleChange} placeholder="Optional" />
                </label>
                <p className="status-line">Leave this blank unless you are creating the admin account. Use the configured admin email or setup code to become an admin.</p>
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
          {user?.role === 'admin' ? (
            <div className="card">
              <h3>Admin users</h3>
              <p className="status-line">Create additional admin accounts here. Each admin can later reset their own password from the email link.</p>
              <form onSubmit={handleCreateAdminUser} className="form-stack">
                <div className="two-col">
                  <label>
                    Email
                    <input name="email" value={adminForm.email} onChange={handleAdminFormChange} type="email" required />
                  </label>
                  <label>
                    Password
                    <input name="password" value={adminForm.password} onChange={handleAdminFormChange} type="password" required />
                  </label>
                </div>
                <div className="two-col">
                  <label>
                    First name
                    <input name="firstName" value={adminForm.firstName} onChange={handleAdminFormChange} required />
                  </label>
                  <label>
                    Last name
                    <input name="lastName" value={adminForm.lastName} onChange={handleAdminFormChange} required />
                  </label>
                </div>
                <button type="submit">Create admin account</button>
              </form>

              <ul className="booking-list">
                {adminUsers.map((adminUser) => (
                  <li key={adminUser.id}>
                    <div>
                      <strong>{adminUser.first_name} {adminUser.last_name}</strong>
                      <p>{adminUser.email}</p>
                    </div>
                    <button type="button" onClick={() => handleResetAdminPassword(adminUser.email)}>Reset password</button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
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
                  <div className="status-actions">
                    <span className="status-pill">{booking.status}</span>
                    {user?.role === 'admin' ? (
                      <div className="inline-actions">
                        <button type="button" onClick={() => handleBookingStatusChange(booking.id, 'Approved')}>Approve</button>
                        <button type="button" onClick={() => handleBookingStatusChange(booking.id, 'Rejected')}>Reject</button>
                      </div>
                    ) : null}
                  </div>
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
