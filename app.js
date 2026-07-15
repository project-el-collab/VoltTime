const STORAGE_KEYS = {
  users: 'volttime.users',
  bookings: 'volttime.bookings',
  notifications: 'volttime.notifications',
};

const seedUsers = [
  {
    id: 'admin-1',
    username: 'admin@volttime.com',
    password: 'admin123',
    firstName: 'Admin',
    lastName: 'User',
    role: 'admin',
  },
];

let users = JSON.parse(localStorage.getItem(STORAGE_KEYS.users) || 'null') || seedUsers;
let bookings = JSON.parse(localStorage.getItem(STORAGE_KEYS.bookings) || '[]');
let notifications = JSON.parse(localStorage.getItem(STORAGE_KEYS.notifications) || '[]');
let currentUser = null;

const registerForm = document.getElementById('registerForm');
const loginForm = document.getElementById('loginForm');
const bookingForm = document.getElementById('bookingForm');
const dashboardSection = document.getElementById('dashboardSection');
const authSection = document.getElementById('authSection');
const statusBox = document.getElementById('statusBox');
const currentUserLabel = document.getElementById('currentUserLabel');
const logoutButton = document.getElementById('logoutButton');
const notificationList = document.getElementById('notificationList');
const adminSection = document.getElementById('adminSection');
const adminBookingList = document.getElementById('adminBookingList');
const toggleButtons = document.querySelectorAll('.toggle-btn');

function saveState() {
  localStorage.setItem(STORAGE_KEYS.users, JSON.stringify(users));
  localStorage.setItem(STORAGE_KEYS.bookings, JSON.stringify(bookings));
  localStorage.setItem(STORAGE_KEYS.notifications, JSON.stringify(notifications));
}

function setStatus(message) {
  statusBox.textContent = message;
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function populateYearSelects() {
  const years = [2025, 2026, 2027, 2028, 2029, 2030];
  const selects = [document.getElementById('startYear'), document.getElementById('endYear')];
  selects.forEach((select) => {
    select.innerHTML = '';
    years.forEach((year) => {
      const option = document.createElement('option');
      option.value = year;
      option.textContent = year;
      select.appendChild(option);
    });
  });
}

function switchView(view) {
  toggleButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });

  registerForm.classList.toggle('hidden', view !== 'register');
  loginForm.classList.toggle('hidden', view !== 'login');
}

function renderDashboard() {
  dashboardSection.classList.remove('hidden');
  authSection.classList.add('hidden');
  currentUserLabel.textContent = `${currentUser.firstName} ${currentUser.lastName}`;

  const userNotifications = notifications.filter((item) => item.userId === currentUser.id);
  notificationList.innerHTML = '';

  if (userNotifications.length === 0) {
    notificationList.innerHTML = '<li>No notifications yet.</li>';
  } else {
    userNotifications.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = `${item.message}`;
      notificationList.appendChild(li);
    });
  }

  if (currentUser.role === 'admin') {
    adminSection.classList.remove('hidden');
    adminBookingList.innerHTML = '';
    const pendingBookings = bookings.filter((booking) => booking.status === 'pending');

    if (pendingBookings.length === 0) {
      adminBookingList.innerHTML = '<li>No pending bookings.</li>';
    } else {
      pendingBookings.forEach((booking) => {
        const li = document.createElement('li');
        li.innerHTML = `
          <strong>${booking.projectName}</strong><br />
          ${booking.place}<br />
          ${booking.startDateTime} to ${booking.endDateTime}<br />
          Submitted by ${booking.userName}<br />
          <button data-action="approve" data-id="${booking.id}">Approve</button>
          <button data-action="reject" data-id="${booking.id}">Reject</button>
        `;
        adminBookingList.appendChild(li);
      });
    }
  } else {
    adminSection.classList.add('hidden');
  }
}

function loginUser(user) {
  currentUser = user;
  saveState();
  renderDashboard();
  setStatus(`Welcome back, ${user.firstName}.`);
}

function logoutUser() {
  currentUser = null;
  dashboardSection.classList.add('hidden');
  authSection.classList.remove('hidden');
  setStatus('');
  switchView('register');
}

registerForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const username = document.getElementById('registerUsername').value.trim();
  const password = document.getElementById('registerPassword').value;
  const firstName = document.getElementById('registerFirstName').value.trim();
  const lastName = document.getElementById('registerLastName').value.trim();

  if (!username || !password || !firstName || !lastName) {
    setStatus('All registration fields are required.');
    return;
  }

  if (users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
    setStatus('A user with that email already exists.');
    return;
  }

  const newUser = {
    id: createId('user'),
    username,
    password,
    firstName,
    lastName,
    role: 'user',
  };

  users.push(newUser);
  saveState();
  registerForm.reset();
  loginUser(newUser);
  setStatus('Registration complete. Your account is now active.');
});

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;

  const foundUser = users.find(
    (user) => user.username.toLowerCase() === username.toLowerCase() && user.password === password
  );

  if (!foundUser) {
    setStatus('Invalid username or password.');
    return;
  }

  loginUser(foundUser);
});

bookingForm.addEventListener('submit', (event) => {
  event.preventDefault();

  if (!currentUser) {
    setStatus('Please sign in before submitting a booking.');
    return;
  }

  const data = {
    startYear: document.getElementById('startYear').value,
    startDate: document.getElementById('startDate').value,
    startTime: document.getElementById('startTime').value,
    startMinutes: document.getElementById('startMinutes').value,
    endYear: document.getElementById('endYear').value,
    endDate: document.getElementById('endDate').value,
    endTime: document.getElementById('endTime').value,
    endMinutes: document.getElementById('endMinutes').value,
    place: document.getElementById('place').value.trim(),
    projectName: document.getElementById('projectName').value.trim(),
    notes: document.getElementById('notes').value.trim(),
  };

  if (!data.place || !data.projectName) {
    setStatus('Place of working and project name are required.');
    return;
  }

  const startDateParts = data.startDate.split('-');
  const endDateParts = data.endDate.split('-');
  const startDateTime = `${data.startYear}-${startDateParts[1]}-${startDateParts[2]} ${data.startTime}:${data.startMinutes}`;
  const endDateTime = `${data.endYear}-${endDateParts[1]}-${endDateParts[2]} ${data.endTime}:${data.endMinutes}`;

  const booking = {
    id: createId('booking'),
    userId: currentUser.id,
    userName: `${currentUser.firstName} ${currentUser.lastName}`,
    startDateTime,
    endDateTime,
    place: data.place,
    projectName: data.projectName,
    notes: data.notes,
    status: 'pending',
  };

  bookings.push(booking);
  saveState();
  bookingForm.reset();
  setStatus('Booking submitted successfully. Admin review is pending.');
  renderDashboard();

  if (users.some((user) => user.role === 'admin')) {
    notifications.push({
      id: createId('notify'),
      userId: users.find((user) => user.role === 'admin').id,
      message: `New booking request from ${currentUser.firstName} ${currentUser.lastName} for ${data.projectName}.`,
    });
    saveState();
  }
});

adminBookingList.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;

  const bookingId = button.dataset.id;
  const action = button.dataset.action;
  const booking = bookings.find((item) => item.id === bookingId);

  if (!booking) return;

  booking.status = action === 'approve' ? 'approved' : 'rejected';
  notifications.push({
    id: createId('notify'),
    userId: booking.userId,
    message: `Your booking for ${booking.projectName} was ${booking.status}.`,
  });
  saveState();
  renderDashboard();
  setStatus(`Booking ${booking.projectName} was ${booking.status}.`);
});

logoutButton.addEventListener('click', logoutUser);

toggleButtons.forEach((button) => {
  button.addEventListener('click', () => switchView(button.dataset.view));
});

populateYearSelects();
switchView('register');
setStatus('Register or sign in to create a booking request.');
