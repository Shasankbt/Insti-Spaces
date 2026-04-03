import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { loginUser, registerUser } from "../Api";
import "./LoginPrism.css";

export default function Login() {
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState(null);

  const [signupForm, setSignupForm] = useState({
    username: "",
    email: "",
    password: "",
    password2: "",
  });
  const [signupError, setSignupError] = useState(null);

  const { login } = useAuth();
  const navigate = useNavigate();

  const [view, setView] = useState("login");

  const prismTransform = useMemo(() => {
    switch (view) {
      case "signup":
        return "translateZ(-100px) rotateY(-90deg)";
      case "forgot":
        return "translateZ(-100px) rotateY(-180deg)";
      case "contact":
        return "translateZ(-100px) rotateY(90deg)";
      case "thankyou":
        return "translateZ(-100px) rotateX(90deg)";
      case "login":
      default:
        return "translateZ(-100px)";
    }
  }, [view]);

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSignupChange = (e) =>
    setSignupForm({ ...signupForm, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await loginUser(form);
      login(res.data.user, res.data.token);
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.error || "Login failed");
    }
  };

  const handleSignupSubmit = async (e) => {
    e.preventDefault();
    setSignupError(null);

    if (!signupForm.username || !signupForm.email || !signupForm.password) {
      setSignupError("username, email and password are required");
      return;
    }
    if (signupForm.password !== signupForm.password2) {
      setSignupError("Passwords do not match");
      return;
    }

    try {
      await registerUser({
        username: signupForm.username,
        email: signupForm.email,
        password: signupForm.password,
      });

      const res = await loginUser({
        email: signupForm.email,
        password: signupForm.password,
      });
      login(res.data.user, res.data.token);
      navigate("/");
    } catch (err) {
      setSignupError(err.response?.data?.error || "Registration failed");
    }
  };

  const handleShowThankYou = (e) => {
    e.preventDefault();
    setView("thankyou");
  };

  return (
    <div className="login-prism-page">
      <ul className="login-prism-nav">
        <li onClick={() => setView("login")}>Login</li>
        <li onClick={() => setView("signup")}>Sign up</li>
        <li onClick={() => setView("forgot")}>Forgot password</li>
        <li onClick={() => setView("contact")}>Contact us</li>
      </ul>

      <div className="login-prism-wrapper" >
        <div className="login-rec-prism" style={{ transform: prismTransform }}>
          <div className="login-face login-face-front">
            <div className="content">
              <h2>Sign in</h2>
              <form onSubmit={handleSubmit}>
                <div className="field-wrapper">
                  <input
                    type="text"
                    name="email"
                    placeholder="email"
                    value={form.email}
                    onChange={handleChange}
                    autoComplete="email"
                  />
                  <label>e-mail</label>
                </div>

                <div className="field-wrapper">
                  <input
                    type="password"
                    name="password"
                    placeholder="password"
                    value={form.password}
                    onChange={handleChange}
                    autoComplete="current-password"
                  />
                  <label>password</label>
                </div>

                <div className="field-wrapper">
                  <input type="submit" value="Sign in" />
                </div>

                {error ? <div className="login-error">{error}</div> : null}

                <span
                  className="login-prism-links"
                  onClick={() => setView("forgot")}
                >
                  Forgot Password?
                </span>
                <span
                  className="login-prism-links"
                  onClick={() => setView("signup")}
                >
                  Not a user? Sign up
                </span>
              </form>
            </div>
          </div>

          <div className="login-face login-face-back">
            <div className="content">
              <h2>Forgot your password?</h2>
              <small>
                Enter your email so we can send you a reset link for your
                password
              </small>
              <form onSubmit={handleShowThankYou}>
                <div className="field-wrapper">
                  <input type="text" name="email" placeholder="email" />
                  <label>e-mail</label>
                </div>
                <div className="field-wrapper">
                  <input type="submit" value="Send" />
                </div>
              </form>
            </div>
          </div>

          <div className="login-face login-face-right">
            <div className="content">
              <h2>Sign up</h2>
              <form onSubmit={handleSignupSubmit}>
                <div className="field-wrapper">
                  <input
                    type="text"
                    name="username"
                    placeholder="username"
                    value={signupForm.username}
                    onChange={handleSignupChange}
                    autoComplete="username"
                  />
                  <label>username</label>
                </div>

                <div className="field-wrapper">
                  <input
                    type="text"
                    name="email"
                    placeholder="email"
                    value={signupForm.email}
                    onChange={handleSignupChange}
                    autoComplete="email"
                  />
                  <label>e-mail</label>
                </div>

                <div className="field-wrapper">
                  <input
                    type="password"
                    name="password"
                    placeholder="password"
                    value={signupForm.password}
                    onChange={handleSignupChange}
                    autoComplete="new-password"
                  />
                  <label>password</label>
                </div>

                <div className="field-wrapper">
                  <input type="submit" value="Sign up" />
                </div>

                {signupError ? (
                  <div className="login-error">{signupError}</div>
                ) : null}

                <span
                  className="login-prism-links"
                  onClick={() => setView("login")}
                >
                  Already a user? Sign in
                </span>
              </form>
            </div>
          </div>

          <div className="login-face login-face-left">
            <div className="content">
              <h2>Contact us</h2>
              <form onSubmit={handleShowThankYou}>
                <div className="field-wrapper">
                  <input type="text" name="name" placeholder="name" />
                  <label>Name</label>
                </div>
                <div className="field-wrapper">
                  <input type="text" name="email" placeholder="email" />
                  <label>e-mail</label>
                </div>
                <div className="field-wrapper">
                  <textarea placeholder="your message" />
                  <label>your message</label>
                </div>
                <div className="field-wrapper">
                  <input type="submit" value="Send" />
                </div>
              </form>
            </div>
          </div>

          <div className="login-face login-face-bottom">
            <div className="content">
              <div className="thank-you-msg">We can't</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
