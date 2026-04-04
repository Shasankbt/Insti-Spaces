import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import Navbar from "./components/Navbar";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Register from "./pages/Register";
import AddFriends from "./pages/AddFriends";
import Notifications from "./pages/Notifications";
import Spaces from "./pages/Spaces";
import JoinSpace from "./pages/JoinSpace";
import SpaceView from "./pages/SpaceView";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="app-layout">
          <Navbar />
          <main className="app-content">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/spaces" element={<Spaces />} />
              <Route path="/spaces/join" element={<JoinSpace />} />
              <Route path="/spaces/:id" element={<SpaceView />} />
              <Route path="/add-friends" element={<AddFriends />} />
              <Route path="/notifications" element={<Notifications />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}
