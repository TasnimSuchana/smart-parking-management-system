import { Route, Routes } from 'react-router-dom';
import PublicLayout from './layouts/PublicLayout.jsx';
import DashboardLayout from './layouts/DashboardLayout.jsx';
import ProtectedRoute from './routes/ProtectedRoute.jsx';
import Home from './pages/Home.jsx';
import Locations from './pages/Locations.jsx';
import LocationDetail from './pages/LocationDetail.jsx';
import { Login, Register, ForgotPassword, ResetPassword } from './pages/Auth.jsx';
import NotFound from './pages/NotFound.jsx';
import CameraMonitor from './pages/CameraMonitor.jsx';
import { UserOverview, BookRedirect, Bookings, Vehicles, Payments, Notifications, Profile } from './pages/user/UserPages.jsx';
import { Scan, DailyRecords } from './pages/admin/OperationsPages.jsx';
import { AdminOverview, AdminLocations, AdminUsers, AdminPricing, AdminTransactions, AdminSecurity } from './pages/admin/AdminPages.jsx';

const guard = (roles, el) => <ProtectedRoute roles={roles}>{el}</ProtectedRoute>;
export default function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<Home />} />
        <Route path="locations" element={guard(['user', 'admin'], <Locations />)} /><Route path="locations/:id" element={guard(['user', 'admin'], <LocationDetail />)} />
        <Route path="login" element={<Login />} /><Route path="register" element={<Register />} /><Route path="forgot-password" element={<ForgotPassword />} /><Route path="reset-password" element={<ResetPassword />} />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="account" element={guard(['user'], <DashboardLayout />)}>
        <Route index element={<UserOverview />} /><Route path="book" element={<BookRedirect />} /><Route path="bookings" element={<Bookings />} /><Route path="vehicles" element={<Vehicles />} />
        <Route path="payments" element={<Payments />} /><Route path="notifications" element={<Notifications />} /><Route path="profile" element={<Profile />} />
      </Route>
      <Route path="admin" element={guard(['admin'], <DashboardLayout />)}>
        <Route index element={<AdminOverview />} /><Route path="locations" element={<AdminLocations />} /><Route path="users" element={<AdminUsers />} /><Route path="pricing" element={<AdminPricing />} />
        <Route path="bookings" element={<AdminTransactions />} /><Route path="scan" element={<Scan />} /><Route path="records" element={<DailyRecords />} /><Route path="camera" element={<CameraMonitor />} /><Route path="security" element={<AdminSecurity />} />
      </Route>
    </Routes>
  );
}
