import axios from 'axios'

const API = 'http://localhost:3000'

export const registerUser = (data) => axios.post(`${API}/auth/register`, data)
export const loginUser = (data) => axios.post(`${API}/auth/login`, data)