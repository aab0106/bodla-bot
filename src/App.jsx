import React, { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import axios from "axios";

// In production (panel served by Render alongside the API) we use same-origin
// relative paths, so API = "". For local `npm run dev`, set VITE_API_URL to the
// Render backend URL in your .env.
const API = import.meta.env.PROD ? "" : (import.meta.env.VITE_API_URL || "http://localhost:10000");

export default function AdminApp() {
  const [auth, setAuth] = useState(null);
  const [page, setPage] = useState("dashboard");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [clients, setClients] = useState([]);
  const [leads, setLeads] = useState([]);
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [rates, setRates] = useState([]);

  const [selectedClient, setSelectedClient] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [replyText, setReplyText] = useState("");
  const [clientSearch, setClientSearch] = useState("");

  const [rateForm, setRateForm] = useState({
    sector: "",
    sub_category: "",
    type: "residential",
    size: "",
    from: "",
    to: "",
    min: "",
    max: "",
    notes: "",
    features: {},
  });
  const [featureDefs, setFeatureDefs] = useState([]);
  const [pricePreview, setPricePreview] = useState(null);
  const [settings, setSettings] = useState({});
  const [newFeature, setNewFeature] = useState({
    key: "", label: "", input_type: "checkbox", options: "", description: "", sort_order: 0, premium_percent: 0,
  });
  const [invStats, setInvStats] = useState({ total: 0 });
  const [invImporting, setInvImporting] = useState(false);
  const [invResult, setInvResult] = useState(null);
  const [resolveQuery, setResolveQuery] = useState({ sector: "", plot_no: "", size: "" });
  const [resolveResult, setResolveResult] = useState(null);
  const [newLeadForm, setNewLeadForm] = useState({ name: "", phone: "" });
  const [excelData, setExcelData] = useState([]);

  // Drop 1: Projects + Company + edit-rate state
  const [projects, setProjects] = useState([]);
  const [newProject, setNewProject] = useState("");
  const [company, setCompany] = useState({
    name: "", about: "", website: "", phone: "", email: "", address: "",
  });
  const [editingRateId, setEditingRateId] = useState(null);
  const [notifs, setNotifs] = useState([]);
  const [notifUnread, setNotifUnread] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [newUser, setNewUser] = useState({
    username: "", password: "", full_name: "", role: "agent", team_id: "", whatsapp_phone: "",
  });

  // Role-based page guard: if on a page this role can't see, snap to dashboard.
  useEffect(() => {
    if (!auth?.user?.role) return;
    const pagePerms = {
      users: ["admin", "manager"],
      teams: ["admin", "manager"],
      rates: ["admin", "manager"],
      projects: ["admin", "manager"],
      company: ["admin"],
      settings: ["admin"],
      inventory: ["admin", "manager"],
    };
    if (pagePerms[page] && !pagePerms[page].includes(auth.user.role)) {
      setPage("dashboard");
    }
  }, [page, auth?.user?.role]);

  const getHeaders = () => ({ Authorization: `Bearer ${auth?.token}` });

  // Restore auth on app load
  useEffect(() => {
    const saved = localStorage.getItem("bodla_auth");
    if (saved) {
      try {
        setAuth(JSON.parse(saved));
      } catch (e) {
        localStorage.removeItem("bodla_auth");
      }
    }
  }, []);

  // Load dashboard when auth changes
  useEffect(() => {
    if (auth?.token) {
      loadDashboard();
    }
  }, [auth?.token]);

  const login = async () => {
    try {
      const { data } = await axios.post(`${API}/api/login`, {
        username,
        password,
      });
      setAuth(data);
      localStorage.setItem("bodla_auth", JSON.stringify(data));
      setUsername("");
      setPassword("");
    } catch (e) {
      setMsg("Login failed: " + e.response?.data?.error || e.message);
    }
  };

  const logout = () => {
    setAuth(null);
    setClients([]);
    setLeads([]);
    setUsers([]);
    setTeams([]);
    setRates([]);
    localStorage.removeItem("bodla_auth");
    setPage("dashboard");
  };

  const loadDashboard = async () => {
    try {
      const headers = getHeaders();
      const [cdata, ldata] = await Promise.all([
        axios.get(`${API}/api/clients`, { headers }),
        axios.get(`${API}/api/leads`, { headers }),
      ]);
      setClients(cdata.data || []);
      setLeads(ldata.data || []);
    } catch (e) {
      console.error("loadDashboard error:", e.message);
    }
  };

  const loadClients = async () => {
    try {
      const { data } = await axios.get(`${API}/api/clients`, {
        headers: getHeaders(),
      });
      setClients(data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const loadLeads = async () => {
    try {
      const { data } = await axios.get(`${API}/api/leads`, {
        headers: getHeaders(),
      });
      setLeads(data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const loadUsers = async () => {
    try {
      const { data } = await axios.get(`${API}/api/users`, {
        headers: getHeaders(),
      });
      setUsers(data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const loadTeams = async () => {
    try {
      const { data } = await axios.get(`${API}/api/teams`, {
        headers: getHeaders(),
      });
      setTeams(data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const loadRates = async () => {
    try {
      const { data } = await axios.get(`${API}/api/plot-rates-v2`, {
        headers: getHeaders(),
      });
      setRates(data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const loadProjects = async () => {
    try {
      const { data } = await axios.get(`${API}/api/projects`, {
        headers: getHeaders(),
      });
      setProjects(data || []);
    } catch (e) {
      console.error("loadProjects error:", e.message);
    }
  };

  const addProject = async () => {
    if (!newProject.trim()) return;
    try {
      await axios.post(`${API}/api/projects`, { name: newProject.trim() }, {
        headers: getHeaders(),
      });
      setNewProject("");
      setMsg("Project added");
      loadProjects();
    } catch (e) {
      setMsg("Error: " + (e.response?.data?.error || e.message));
    }
  };

  const loadCompany = async () => {
    try {
      const { data } = await axios.get(`${API}/api/company-profile`, {
        headers: getHeaders(),
      });
      if (data) {
        setCompany({
          name: data.name || "", about: data.about || "",
          website: data.website || "", phone: data.phone || "",
          email: data.email || "", address: data.address || "",
        });
      }
    } catch (e) {
      console.error("loadCompany error:", e.message);
    }
  };

  const saveCompany = async () => {
    try {
      await axios.post(`${API}/api/company-profile`, company, {
        headers: getHeaders(),
      });
      setMsg("Company info saved");
    } catch (e) {
      setMsg("Error: " + (e.response?.data?.error || e.message));
    }
  };

  // Load page-specific data when navigating
  useEffect(() => {
    if (!auth?.token) return;
    if (page === "projects") loadProjects();
    if (page === "company") loadCompany();
    if (page === "users") { loadUsers(); loadTeams(); }
    if (page === "rates") loadFeatures();
    if (page === "settings") { loadFeatures(); loadSettings(); }
    if (page === "inventory") loadInvStats();
  }, [page, auth?.token]);

  const loadInvStats = async () => {
    try {
      const { data } = await axios.get(`${API}/api/inventory/stats`, { headers: getHeaders() });
      setInvStats(data || { total: 0 });
    } catch (e) { /* non-critical */ }
  };

  // Parse Excel client-side, send rows to backend in chunks (handles big files).
  const importInventory = async (file) => {
    if (!file) return;
    setInvImporting(true);
    setInvResult(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
      if (!rows.length) { setMsg("Sheet is empty"); setInvImporting(false); return; }

      // Send in chunks of 2000 rows to avoid huge single requests.
      const CHUNK = 2000;
      let inserted = 0, skipped = 0, total = rows.length;
      const errors = [];
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        const { data } = await axios.post(`${API}/api/inventory/import`, { rows: slice }, { headers: getHeaders() });
        inserted += data.inserted || 0;
        skipped += data.skipped || 0;
        if (data.errors?.length) errors.push(...data.errors);
        setInvResult({ inserted, skipped, total, inProgress: i + CHUNK < rows.length });
      }
      setInvResult({ inserted, skipped, total, errors, inProgress: false });
      setMsg(`Imported ${inserted} plots`);
      loadInvStats();
    } catch (e) {
      setMsg("Import error: " + (e.response?.data?.error || e.message));
    }
    setInvImporting(false);
  };

  const resolvePlot = async () => {
    try {
      const { data } = await axios.get(`${API}/api/inventory/resolve`, {
        headers: getHeaders(),
        params: resolveQuery,
      });
      setResolveResult(data);
    } catch (e) {
      setMsg("Error: " + (e.response?.data?.error || e.message));
    }
  };

  const loadSettings = async () => {
    try {
      const { data } = await axios.get(`${API}/api/settings`, { headers: getHeaders() });
      setSettings(data || {});
    } catch (e) {
      console.error("loadSettings error:", e.message);
    }
  };

  const saveSettings = async (updates) => {
    try {
      await axios.post(`${API}/api/settings`, updates, { headers: getHeaders() });
      setSettings((prev) => ({ ...prev, ...updates }));
      setMsg("Settings saved");
    } catch (e) {
      setMsg("Error: " + (e.response?.data?.error || e.message));
    }
  };

  const saveFeatureDef = async (feature) => {
    if (!feature.key.trim() || !feature.label.trim()) {
      setMsg("Feature key and label are required");
      return;
    }
    try {
      await axios.post(`${API}/api/features/def`, feature, { headers: getHeaders() });
      setMsg("Feature saved");
      setNewFeature({ key: "", label: "", input_type: "checkbox", options: "", description: "", sort_order: 0, premium_percent: 0 });
      loadFeatures();
    } catch (e) {
      setMsg("Error: " + (e.response?.data?.error || e.message));
    }
  };

  const deleteFeatureDef = async (key) => {
    if (!window.confirm(`Delete feature "${key}"? This removes it from all plot forms.`)) return;
    try {
      await axios.delete(`${API}/api/features/def/${encodeURIComponent(key)}`, { headers: getHeaders() });
      setMsg("Feature deleted");
      loadFeatures();
    } catch (e) {
      setMsg("Error: " + (e.response?.data?.error || e.message));
    }
  };

  const loadFeatures = async () => {
    try {
      const { data } = await axios.get(`${API}/api/features`, { headers: getHeaders() });
      setFeatureDefs(data || []);
    } catch (e) {
      console.error("loadFeatures error:", e.message);
    }
  };

  // Live price preview: base × (1 + sum of checked feature %)
  const computePreview = (form, defs) => {
    const min = parseFloat(form.min);
    const max = parseFloat(form.max);
    if (!min || !max || !defs.length) { setPricePreview(null); return; }
    let totalPct = 0;
    let extraLand = false;
    for (const d of defs) {
      if (!form.features?.[d.key]) continue;
      if (d.key === "extra_land") { extraLand = true; continue; }
      totalPct += Number(d.premium_percent) || 0;
    }
    const factor = 1 + totalPct / 100;
    setPricePreview({
      min: (min * factor).toFixed(1),
      max: (max * factor).toFixed(1),
      totalPct,
      extraLand,
    });
  };

  const toggleFeature = (key) => {
    const next = { ...rateForm, features: { ...rateForm.features, [key]: !rateForm.features?.[key] } };
    setRateForm(next);
    computePreview(next, featureDefs);
  };

  const updatePremium = async (featureKey, percent) => {
    try {
      await axios.post(`${API}/api/features/premium`,
        { feature_key: featureKey, premium_percent: parseFloat(percent) || 0 },
        { headers: getHeaders() });
      loadFeatures();
      setMsg("Premium updated");
    } catch (e) {
      setMsg("Error: " + (e.response?.data?.error || e.message));
    }
  };

  // ─── Notifications ──────────────────────────────────────────────
  const loadNotifs = async () => {
    try {
      const { data } = await axios.get(`${API}/api/notifications`, { headers: getHeaders() });
      setNotifs(data.notifications || []);
      setNotifUnread(data.unread || 0);
    } catch (e) {
      // non-critical
    }
  };

  const markNotifsRead = async () => {
    try {
      await axios.post(`${API}/api/notifications/read`, {}, { headers: getHeaders() });
      setNotifUnread(0);
      setNotifs((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch (e) {}
  };

  // Poll notifications every 30s while logged in
  useEffect(() => {
    if (!auth?.token) return;
    loadNotifs();
    const iv = setInterval(loadNotifs, 30000);
    return () => clearInterval(iv);
  }, [auth?.token]);

  const selectClient = async (client) => {
    setSelectedClient(client);
    setChatMessages(client.messages || []);
    // Stop the SLA clock — agent has opened/seen this chat.
    try {
      await axios.post(`${API}/api/leads/${encodeURIComponent(client.phone)}/seen`, {}, { headers: getHeaders() });
    } catch (e) {
      // non-critical
    }
  };

  const sendReply = async () => {
    if (!replyText.trim() || !selectedClient) return;
    setLoading(true);
    try {
      await axios.post(
        `${API}/api/agent/reply`,
        {
          client_phone: selectedClient.phone,
          message: replyText,
        },
        { headers: getHeaders() },
      );
      setReplyText("");
      setMsg("✓ Message sent!");
      // Re-fetch clients and refresh the open chat from the FRESH data
      // (avoids a race where clients state isn't updated yet).
      const { data: fresh } = await axios.get(`${API}/api/clients`, {
        headers: getHeaders(),
      });
      setClients(fresh || []);
      const updated = (fresh || []).find((c) => c.phone === selectedClient.phone);
      if (updated) {
        setSelectedClient(updated);
        setChatMessages(updated.messages || []);
      }
    } catch (e) {
      setMsg("Error: " + e.response?.data?.error || e.message);
    }
    setLoading(false);
  };

  const addNewLead = async () => {
    if (!newLeadForm.name.trim() || !newLeadForm.phone.trim()) {
      setMsg("Name and phone required");
      return;
    }
    try {
      await axios.post(
        `${API}/api/clients`,
        {
          phone: newLeadForm.phone,
          name: newLeadForm.name,
        },
        { headers: getHeaders() },
      );
      setMsg("✓ Lead added!");
      setNewLeadForm({ name: "", phone: "" });
      await loadClients();
    } catch (e) {
      setMsg("Error: " + e.response?.data?.error || e.message);
    }
  };

  const filterClients = clients.filter(
    (c) =>
      c.name?.toLowerCase().includes(clientSearch.toLowerCase()) ||
      c.phone?.includes(clientSearch),
  );

  const saveRate = async () => {
    if (
      !rateForm.sector ||
      !rateForm.size ||
      !rateForm.from ||
      !rateForm.to ||
      !rateForm.min ||
      !rateForm.max
    ) {
      setMsg("Fill all required fields");
      return;
    }
    try {
      await axios.post(
        `${API}/api/plot-rates-v2`,
        {
          id: editingRateId || undefined,
          sector: rateForm.sector,
          sub_category: rateForm.sub_category,
          plot_type: rateForm.type,
          size: rateForm.size,
          plot_no_from: parseInt(rateForm.from),
          plot_no_to: parseInt(rateForm.to),
          min_price: Math.round(parseFloat(rateForm.min) * 100000),
          max_price: Math.round(parseFloat(rateForm.max) * 100000),
          features: rateForm.features || {},
          notes: rateForm.notes,
        },
        { headers: getHeaders() },
      );
      setMsg(editingRateId ? "✓ Updated!" : "✓ Saved!");
      setEditingRateId(null);
      setRateForm({
        sector: "",
        sub_category: "",
        type: "residential",
        size: "",
        from: "",
        to: "",
        min: "",
        max: "",
        notes: "",
        features: {},
      });
      setPricePreview(null);
      loadRates();
    } catch (e) {
      setMsg("Error: " + e.response?.data?.error || e.message);
    }
  };

  const editRate = (r) => {
    setEditingRateId(r.id);
    const form = {
      sector: r.sector || "",
      sub_category: r.sub_category || "",
      type: r.plot_type || "residential",
      size: r.size || "",
      from: r.plot_no_from ?? "",
      to: r.plot_no_to ?? "",
      min: r.min_price ? r.min_price / 100000 : "",
      max: r.max_price ? r.max_price / 100000 : "",
      notes: r.notes || "",
      features: r.features || {},
    };
    setRateForm(form);
    computePreview(form, featureDefs);
    setMsg("Editing rate — update the form and Save");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelEditRate = () => {
    setEditingRateId(null);
    setRateForm({ sector: "", sub_category: "", type: "residential", size: "", from: "", to: "", min: "", max: "", notes: "", features: {} });
    setPricePreview(null);
    setMsg("");
  };

  const deleteRate = async (id) => {
    if (!window.confirm("Delete this plot rate?")) return;
    try {
      await axios.delete(`${API}/api/plot-rates-v2/${id}`, { headers: getHeaders() });
      setMsg("Rate deleted");
      loadRates();
    } catch (e) {
      setMsg("Error: " + (e.response?.data?.error || e.message));
    }
  };

  // Drop 2: user + team edit/delete
  const createUser = async () => {
    if (!newUser.username.trim() || !newUser.password.trim() || !newUser.full_name.trim()) {
      setMsg("Username, password and full name are required");
      return;
    }
    try {
      await axios.post(`${API}/api/users`, {
        username: newUser.username.trim(),
        password: newUser.password,
        full_name: newUser.full_name.trim(),
        role: newUser.role,
        team_id: newUser.team_id || null,
      }, { headers: getHeaders() });
      // If a whatsapp number was given, set it via update (create endpoint doesn't take it)
      setMsg("✓ User created");
      setNewUser({ username: "", password: "", full_name: "", role: "agent", team_id: "", whatsapp_phone: "" });
      loadUsers();
    } catch (e) {
      setMsg("Error: " + (e.response?.data?.error || e.message));
    }
  };

  const editUser = async (u) => {
    const full_name = window.prompt("Full name:", u.full_name || "");
    if (full_name === null) return;
    const role = window.prompt("Role (admin/manager/agent):", u.role || "agent");
    if (role === null) return;
    const whatsapp_phone = window.prompt("WhatsApp phone (e.g. +9230...):", u.whatsapp_phone || "");
    if (whatsapp_phone === null) return;
    const newPassword = window.prompt("New password (leave blank to keep current):", "");
    if (newPassword === null) return;
    const payload = { full_name, role, whatsapp_phone };
    if (newPassword.trim()) payload.password = newPassword.trim();
    try {
      await axios.put(`${API}/api/users/${u.id}`, payload, { headers: getHeaders() });
      setMsg(newPassword.trim() ? "User updated (password changed)" : "User updated");
      loadUsers();
    } catch (e) {
      setMsg("Error: " + (e.response?.data?.error || e.message));
    }
  };

  const deleteUser = async (u) => {
    if (!window.confirm(`Delete ${u.full_name}? Their leads go back to the pool.`)) return;
    try {
      await axios.delete(`${API}/api/users/${u.id}`, { headers: getHeaders() });
      setMsg("User deleted, leads unassigned");
      loadUsers();
    } catch (e) {
      setMsg("Error: " + (e.response?.data?.error || e.message));
    }
  };

  const editTeam = async (t) => {
    const name = window.prompt("Team name:", t.name || "");
    if (name === null) return;
    try {
      await axios.put(`${API}/api/teams/${t.id}`, { name }, { headers: getHeaders() });
      setMsg("Team updated");
      loadTeams();
    } catch (e) {
      setMsg("Error: " + (e.response?.data?.error || e.message));
    }
  };

  const deleteTeam = async (t) => {
    if (!window.confirm(`Delete team "${t.name}"? Members and clients will be detached.`)) return;
    try {
      await axios.delete(`${API}/api/teams/${t.id}`, { headers: getHeaders() });
      setMsg("Team deleted");
      loadTeams();
    } catch (e) {
      setMsg("Error: " + (e.response?.data?.error || e.message));
    }
  };

  const handleExcelFile = async (file) => {
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      if (rows.length < 2) {
        setMsg("File appears empty");
        return;
      }

      const headers = rows[0].map((h) => String(h).trim());
      const dataRows = rows
        .slice(1)
        .filter((r) => r.some((c) => String(c).trim() !== ""));

      setExcelData(
        dataRows.map((row) => {
          const obj = {};
          headers.forEach((h, i) => (obj[h] = String(row[i] || "").trim()));
          return obj;
        }),
      );
      setMsg(`Preview: ${dataRows.length} rows`);
    } catch (e) {
      setMsg("Error reading file: " + e.message);
    }
  };

  const importExcel = async () => {
    setLoading(true);
    let success = 0,
      failed = 0;
    for (const row of excelData) {
      try {
        const plotNoRaw = String(
          row["Plot Number"] || row["plot_number"] || "1",
        );
        let from, to;
        if (plotNoRaw.includes("-")) {
          const [f, t] = plotNoRaw.split("-");
          from = parseInt(f);
          to = parseInt(t);
        } else {
          from = to = parseInt(plotNoRaw);
        }

        await axios.post(
          `${API}/api/plot-rates-v2`,
          {
            sector: row["Sector"] || "",
            plot_type: (row["Plot Type"] || "residential").toLowerCase(),
            size: row["Size"] || "",
            plot_no_from: from,
            plot_no_to: to,
            min_price: Math.round(parseFloat(row["Min Price"] || 0) * 100000),
            max_price: Math.round(parseFloat(row["Max Price"] || 0) * 100000),
            features: {},
            notes: "",
          },
          { headers: getHeaders() },
        );
        success++;
      } catch {
        failed++;
      }
    }
    setLoading(false);
    setMsg(`✓ ${success} imported${failed > 0 ? `, ${failed} failed` : ""}`);
    setExcelData([]);
    loadRates();
  };

  const downloadTemplate = () => {
    const headers = [
      "Sector",
      "Plot Type",
      "Plot Number",
      "Size",
      "Min Price",
      "Max Price",
    ];
    const data = [
      ["V", "Residential", "5789", "5 Marla", "18", "25"],
      ["K", "Residential", "101", "1 Kanal", "70", "100"],
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rates");
    XLSX.writeFile(wb, "Bodla_Rates_Template.xlsx");
  };

  if (!auth)
    return (
      <div
        style={{
          maxWidth: 400,
          margin: "100px auto",
          padding: 20,
          border: "1px solid #ddd",
          borderRadius: 8,
        }}
      >
        <h1 style={{ textAlign: "center", color: "#1a6b3c" }}>
          Bodla Bot Admin
        </h1>
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={{
            width: "100%",
            padding: 10,
            marginBottom: 10,
            border: "1px solid #ccc",
            borderRadius: 4,
            boxSizing: "border-box",
          }}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && login()}
          style={{
            width: "100%",
            padding: 10,
            marginBottom: 10,
            border: "1px solid #ccc",
            borderRadius: 4,
            boxSizing: "border-box",
          }}
        />
        <button
          onClick={login}
          style={{
            width: "100%",
            padding: 10,
            background: "#1a6b3c",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Sign In
        </button>
        {msg && (
          <p style={{ color: "red", fontSize: 12, marginTop: 10 }}>{msg}</p>
        )}
      </div>
    );

  return (
    <div style={{ display: "flex", height: "100vh", background: "#f9fafb" }}>
      <div
        style={{
          width: 220,
          background: "#1f2937",
          color: "white",
          padding: 20,
          overflow: "auto",
        }}
      >
        <h2 style={{ fontSize: 14, marginBottom: 20 }}>BODLA BOT</h2>
        {[
          { id: "dashboard", label: "Dashboard", roles: ["admin", "manager", "agent"] },
          { id: "chats", label: "Chats", roles: ["admin", "manager", "agent"] },
          { id: "leads", label: "Leads", roles: ["admin", "manager", "agent"] },
          { id: "users", label: "Users", roles: ["admin", "manager"] },
          { id: "teams", label: "Teams", roles: ["admin", "manager"] },
          { id: "rates", label: "Plot Rates", roles: ["admin", "manager"] },
          { id: "projects", label: "Projects", roles: ["admin", "manager"] },
          { id: "company", label: "Company Info", roles: ["admin"] },
          { id: "settings", label: "Settings", roles: ["admin"] },
          { id: "inventory", label: "Plots Data", roles: ["admin", "manager"] },
        ]
          .filter((item) => item.roles.includes(auth?.user?.role))
          .map((item) => (
          <div
            key={item.id}
            onClick={() => {
              setPage(item.id);
              setMsg("");
            }}
            style={{
              padding: 10,
              cursor: "pointer",
              background: page === item.id ? "#1a6b3c" : "transparent",
              borderRadius: 4,
              marginBottom: 5,
            }}
          >
            {item.label}
          </div>
        ))}
        <button
          onClick={logout}
          style={{
            width: "100%",
            marginTop: 20,
            padding: 8,
            background: "#dc2626",
            border: "none",
            color: "white",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          Sign out
        </button>
      </div>

      <div style={{ flex: 1, padding: 20, overflow: "auto" }}>
        {/* Top bar with notification bell */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8, position: "relative" }}>
          <button
            onClick={() => {
              const opening = !notifOpen;
              setNotifOpen(opening);
              if (opening && notifUnread > 0) markNotifsRead();
            }}
            style={{
              position: "relative", background: "white", border: "1px solid #e5e7eb",
              borderRadius: 8, width: 40, height: 40, cursor: "pointer", fontSize: 18,
            }}
            title="Notifications"
          >
            🔔
            {notifUnread > 0 && (
              <span style={{
                position: "absolute", top: -6, right: -6, background: "#dc2626", color: "white",
                borderRadius: "50%", minWidth: 18, height: 18, fontSize: 11, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px",
              }}>
                {notifUnread > 99 ? "99+" : notifUnread}
              </span>
            )}
          </button>

          {notifOpen && (
            <div style={{
              position: "absolute", top: 46, right: 0, width: 340, maxHeight: 420, overflowY: "auto",
              background: "white", border: "1px solid #e5e7eb", borderRadius: 10,
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 50,
            }}>
              <div style={{ padding: "12px 14px", borderBottom: "1px solid #eee", fontWeight: 600, fontSize: 13 }}>
                Notifications
              </div>
              {notifs.length === 0 ? (
                <div style={{ padding: 20, color: "#9ca3af", fontSize: 13, textAlign: "center" }}>
                  No notifications
                </div>
              ) : (
                notifs.map((n) => {
                  const color = n.type === "SLA_MANAGER_ESCALATION" ? "#dc2626"
                    : n.type === "SLA_AGENT_REMINDER" ? "#d97706" : "#1a6b3c";
                  return (
                    <div
                      key={n.id}
                      onClick={() => {
                        if (n.client_phone) {
                          setPage("chats");
                          setNotifOpen(false);
                        }
                      }}
                      style={{
                        padding: "10px 14px", borderBottom: "1px solid #f3f4f6",
                        cursor: n.client_phone ? "pointer" : "default",
                        background: n.is_read ? "white" : "#f0fdf4",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }} />
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{n.title}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "#4b5563" }}>{n.body}</div>
                      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 3 }}>
                        {new Date(n.created_at).toLocaleString()}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        <h1 style={{ marginBottom: 20 }}>
          {page === "dashboard"
            ? "Dashboard"
            : page === "chats"
              ? "Chats"
              : page === "leads"
                ? "Leads"
                : page === "users"
                  ? "Users"
                  : page === "teams"
                    ? "Teams"
                    : page === "projects"
                      ? "Projects"
                      : page === "company"
                        ? "Company Info"
                        : page === "settings"
                          ? "Settings"
                          : page === "inventory"
                            ? "Plots Data"
                            : "Plot Rates"}
        </h1>

        {page === "dashboard" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 15,
              marginBottom: 20,
            }}
          >
            <div
              style={{
                background: "white",
                padding: 20,
                borderRadius: 8,
                border: "1px solid #e5e7eb",
              }}
            >
              <div style={{ fontSize: 12, color: "#666" }}>Total Clients</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#1a6b3c" }}>
                {clients.length}
              </div>
            </div>
            <div
              style={{
                background: "white",
                padding: 20,
                borderRadius: 8,
                border: "1px solid #e5e7eb",
              }}
            >
              <div style={{ fontSize: 12, color: "#666" }}>Escalated</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#d97706" }}>
                {clients.filter((c) => c.escalated).length}
              </div>
            </div>
            <div
              style={{
                background: "white",
                padding: 20,
                borderRadius: 8,
                border: "1px solid #e5e7eb",
              }}
            >
              <div style={{ fontSize: 12, color: "#666" }}>Assigned</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#1d4ed8" }}>
                {clients.filter((c) => c.assigned_to).length}
              </div>
            </div>
            <div
              style={{
                background: "white",
                padding: 20,
                borderRadius: 8,
                border: "1px solid #e5e7eb",
              }}
            >
              <div style={{ fontSize: 12, color: "#666" }}>Messages</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#666" }}>
                {clients.reduce((s, c) => s + (c.messages?.length || 0), 0)}
              </div>
            </div>
          </div>
        )}

        {page === "chats" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "300px 1fr",
              gap: 16,
              height: "calc(100vh - 140px)",
            }}
          >
            <div
              style={{
                background: "white",
                borderRadius: 8,
                border: "1px solid #e5e7eb",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              <div style={{ padding: 16, borderBottom: "1px solid #e5e7eb" }}>
                <input
                  type="text"
                  placeholder="Search..."
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  style={{
                    width: "100%",
                    padding: 8,
                    border: "1px solid #ccc",
                    borderRadius: 4,
                    fontSize: 13,
                    boxSizing: "border-box",
                  }}
                />
                <button
                  onClick={loadClients}
                  style={{
                    width: "100%",
                    marginTop: 8,
                    padding: 6,
                    background: "#1a6b3c",
                    color: "white",
                    border: "none",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  Refresh
                </button>
              </div>
              <div style={{ flex: 1, overflow: "auto" }}>
                {filterClients.length === 0 ? (
                  <div
                    style={{ padding: 16, color: "#999", textAlign: "center" }}
                  >
                    No clients
                  </div>
                ) : (
                  filterClients.map((c, i) => (
                    <div
                      key={i}
                      onClick={() => selectClient(c)}
                      style={{
                        padding: 12,
                        borderBottom: "1px solid #e5e7eb",
                        cursor: "pointer",
                        background:
                          selectedClient?.phone === c.phone
                            ? "#f0fdf4"
                            : "white",
                        fontWeight:
                          selectedClient?.phone === c.phone ? 600 : 400,
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 600 }}>
                        {c.name || "Unknown"}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "#999",
                          fontFamily: "monospace",
                        }}
                      >
                        {c.phone}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div style={{ background: 'white', borderRadius: 8, border: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
  {selectedClient ? (
    <>
      <div style={{ padding: 16, borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{selectedClient.name}</div>
        <div style={{ fontSize: 12, color: '#999' }}>{selectedClient.phone}</div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {chatMessages.length === 0 ? (
          <div style={{ color: '#999', textAlign: 'center', margin: 'auto' }}>No messages yet</div>
        ) : (
          chatMessages.map((m, i) => {
            const time = new Date(m.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            // Staff messages (agent/admin/manager reply) carry sender info.
            let sender;
            if (m.role === 'user') {
              sender = 'Client';
            } else if (m.role === 'agent') {
              // Show "Name (Role)" when we recorded who sent it, else just "Agent".
              const roleLabel = m.sender_role
                ? m.sender_role.charAt(0).toUpperCase() + m.sender_role.slice(1)
                : 'Agent';
              sender = m.sender_name ? `${m.sender_name} (${roleLabel})` : roleLabel;
            } else {
              sender = 'Bot';
            }
            const senderColor = m.role === 'user' ? '#999' : m.role === 'agent' ? '#1d4ed8' : '#666';
            
            return (
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: senderColor, fontWeight: 600, marginBottom: 2 }}>{sender}</div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
                  <div style={{ maxWidth: '70%', padding: '10px 14px', borderRadius: 12, fontSize: 13, background: m.role === 'user' ? '#dcf8c6' : m.role === 'agent' ? '#dbeafe' : '#f0f0f0', lineHeight: 1.5 }}>
                    {m.content}
                  </div>
                  <div style={{ fontSize: 11, color: '#999', whiteSpace: 'nowrap' }}>{time}</div>
                </div>
              </div>
            );
          })
        )}
      </div>
      <div style={{ padding: 16, borderTop: '1px solid #e5e7eb', display: 'flex', gap: 8 }}>
        <input type="text" placeholder="Type reply..." value={replyText} onChange={e => setReplyText(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendReply()} style={{ flex: 1, padding: 10, border: '1px solid #ccc', borderRadius: 4, fontSize: 13, boxSizing: 'border-box' }} />
        <button onClick={sendReply} disabled={loading} style={{ padding: '10px 16px', background: loading ? '#ccc' : '#1a6b3c', color: 'white', border: 'none', borderRadius: 4, cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 13 }}>Send</button>
      </div>
    </>
  ) : (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>Select a client to view chat</div>
  )}
</div>
          </div>
        )}

        {page === "leads" && (
  <div>
    {(auth?.user?.role === "admin" || auth?.user?.role === "manager") && (
    <div
      style={{
        background: "white",
        padding: 20,
        borderRadius: 8,
        marginBottom: 20,
        border: "1px solid #e5e7eb",
      }}
    >
      <h3>Assign Lead to Agent</h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <select
          id="leadSelect"
          style={{
            padding: 8,
            border: "1px solid #ccc",
            borderRadius: 4,
            fontSize: 13,
          }}
        >
          <option value="">Select Lead</option>
          {leads.map((l, i) => (
            <option key={i} value={l.phone}>
              {l.name} - {l.phone}
            </option>
          ))}
        </select>
        <select
          id="agentSelect"
          style={{
            padding: 8,
            border: "1px solid #ccc",
            borderRadius: 4,
            fontSize: 13,
          }}
        >
          <option value="">Select Agent</option>
          {users
            .filter((u) => u.role === "agent")
            .map((u, i) => (
              <option key={i} value={u.id}>
                {u.full_name}
              </option>
            ))}
        </select>
        <button
          onClick={async () => {
            const clientPhone = document.getElementById("leadSelect").value;
            const agentId = document.getElementById("agentSelect").value;
            if (!clientPhone || !agentId) {
              setMsg("Select both lead and agent");
              return;
            }
            try {
              await axios.post(
                `${API}/api/leads/assign`,
                { client_phone: clientPhone, agent_id: agentId },
                { headers: getHeaders() }
              );
              setMsg("✓ Lead assigned!");
              document.getElementById("leadSelect").value = "";
              document.getElementById("agentSelect").value = "";
              await loadLeads();
            } catch (e) {
              setMsg("Error: " + (e.response?.data?.error || e.message));
            }
          }}
          style={{
            background: "#1a6b3c",
            color: "white",
            padding: 8,
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Assign
        </button>
      </div>
      {msg && (
        <span
          style={{
            fontSize: 12,
            color: msg.includes("✓") ? "#1a6b3c" : "#dc2626",
          }}
        >
          {msg}
        </span>
      )}
    </div>
    )}

    <div
      style={{
        background: "white",
        padding: 20,
        borderRadius: 8,
        marginBottom: 20,
        border: "1px solid #e5e7eb",
      }}
    >
      <h3>Add New Lead</h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <input
          type="text"
          placeholder="Name"
          value={newLeadForm.name}
          onChange={(e) =>
            setNewLeadForm({ ...newLeadForm, name: e.target.value })
          }
          style={{
            padding: 8,
            border: "1px solid #ccc",
            borderRadius: 4,
            fontSize: 13,
          }}
        />
        <input
          type="text"
          placeholder="Phone"
          value={newLeadForm.phone}
          onChange={(e) =>
            setNewLeadForm({ ...newLeadForm, phone: e.target.value })
          }
          style={{
            padding: 8,
            border: "1px solid #ccc",
            borderRadius: 4,
            fontSize: 13,
          }}
        />
        <button
          onClick={addNewLead}
          style={{
            background: "#1a6b3c",
            color: "white",
            padding: 8,
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Add Lead
        </button>
      </div>
      {msg && (
        <span
          style={{
            fontSize: 12,
            color: msg.includes("✓") ? "#1a6b3c" : "#dc2626",
          }}
        >
          {msg}
        </span>
      )}
    </div>

    <button
      onClick={loadLeads}
      style={{
        padding: 8,
        marginBottom: 15,
        background: "#1a6b3c",
        color: "white",
        border: "none",
        borderRadius: 4,
        cursor: "pointer",
      }}
    >
      Load Leads
    </button>
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        background: "white",
        borderRadius: 8,
      }}
    >
      <thead>
        <tr
          style={{
            background: "#f3f4f6",
            borderBottom: "1px solid #e5e7eb",
          }}
        >
          <th
            style={{
              padding: 12,
              textAlign: "left",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Client
          </th>
          <th
            style={{
              padding: 12,
              textAlign: "left",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Phone
          </th>
          <th
            style={{
              padding: 12,
              textAlign: "left",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Status
          </th>
        </tr>
      </thead>
      <tbody>
        {leads.map((l, i) => (
          <tr key={i} style={{ borderBottom: "1px solid #e5e7eb" }}>
            <td style={{ padding: 12 }}>{l.name || "Unknown"}</td>
            <td
              style={{
                padding: 12,
                fontFamily: "monospace",
                fontSize: 12,
              }}
            >
              {l.phone}
            </td>
            <td style={{ padding: 12 }}>
              <span
                style={{
                  background: l.is_locked ? "#d1fae5" : "#fef3c7",
                  padding: "4px 8px",
                  borderRadius: 4,
                  fontSize: 12,
                }}
              >
                {l.is_locked ? "Locked" : "Open"}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)}

        {page === "users" && (
          <div>
            <div style={{ background: "white", padding: 20, borderRadius: 8, marginBottom: 20, border: "1px solid #e5e7eb" }}>
              <h3 style={{ marginTop: 0 }}>Create User</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                <input placeholder="Full name" value={newUser.full_name}
                  onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })}
                  style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }} />
                <input placeholder="Username" value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }} />
                <input placeholder="Password" type="password" value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }} />
                <select value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                  style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }}>
                  <option value="agent">Agent</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
                <select value={newUser.team_id}
                  onChange={(e) => setNewUser({ ...newUser, team_id: e.target.value })}
                  style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }}>
                  <option value="">— No team —</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <button onClick={createUser}
                style={{ padding: "8px 20px", background: "#1a6b3c", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}>
                Create User
              </button>
            </div>
            <button
              onClick={loadUsers}
              style={{
                padding: 8,
                marginBottom: 15,
                background: "#1a6b3c",
                color: "white",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              Load Users
            </button>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                background: "white",
                borderRadius: 8,
              }}
            >
              <thead>
                <tr
                  style={{
                    background: "#f3f4f6",
                    borderBottom: "1px solid #e5e7eb",
                  }}
                >
                  <th
                    style={{
                      padding: 12,
                      textAlign: "left",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    Name
                  </th>
                  <th
                    style={{
                      padding: 12,
                      textAlign: "left",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    Username
                  </th>
                  <th
                    style={{
                      padding: 12,
                      textAlign: "left",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    Role
                  </th>
                  <th
                    style={{
                      padding: 12,
                      textAlign: "left",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    Team
                  </th>
                  <th
                    style={{
                      padding: 12,
                      textAlign: "left",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    Status
                  </th>
                  <th
                    style={{
                      padding: 12,
                      textAlign: "left",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #e5e7eb" }}>
                    <td style={{ padding: 12 }}>{u.full_name}</td>
                    <td
                      style={{
                        padding: 12,
                        fontFamily: "monospace",
                        fontSize: 12,
                      }}
                    >
                      {u.username}
                    </td>
                    <td style={{ padding: 12 }}>
                      <span
                        style={{
                          background:
                            u.role === "admin"
                              ? "#fee2e2"
                              : u.role === "manager"
                                ? "#dbeafe"
                                : "#f0fdf4",
                          padding: "4px 8px",
                          borderRadius: 4,
                          fontSize: 11,
                          color:
                            u.role === "admin"
                              ? "#dc2626"
                              : u.role === "manager"
                                ? "#1d4ed8"
                                : "#1a6b3c",
                        }}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td style={{ padding: 12, fontSize: 13 }}>
                      {u.team?.name || "—"}
                    </td>
                    <td style={{ padding: 12 }}>
                      {u.is_active ? "Active" : "Inactive"}
                    </td>
                    <td style={{ padding: 12 }}>
                      <button
                        onClick={() => editUser(u)}
                        style={{
                          marginRight: 6, padding: "4px 10px", fontSize: 12,
                          background: "#2563eb", color: "white", border: "none",
                          borderRadius: 4, cursor: "pointer",
                        }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteUser(u)}
                        style={{
                          padding: "4px 10px", fontSize: 12,
                          background: "#dc2626", color: "white", border: "none",
                          borderRadius: 4, cursor: "pointer",
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {page === "teams" && (
  <div>
    <div
      style={{
        background: "white",
        padding: 20,
        borderRadius: 8,
        marginBottom: 20,
        border: "1px solid #e5e7eb",
      }}
    >
      <h3>Create New Team</h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <input
          type="text"
          placeholder="Team Name"
          id="teamNameInput"
          style={{
            padding: 8,
            border: "1px solid #ccc",
            borderRadius: 4,
            fontSize: 13,
          }}
        />
        <select
          id="managerSelect"
          style={{
            padding: 8,
            border: "1px solid #ccc",
            borderRadius: 4,
            fontSize: 13,
          }}
        >
          <option value="">Select Manager</option>
          {users
            .filter((u) => u.role === "manager")
            .map((u, i) => (
              <option key={i} value={u.id}>
                {u.full_name}
              </option>
            ))}
        </select>
        <button
          onClick={async () => {
            const name = document.getElementById("teamNameInput").value;
            const managerId = document.getElementById("managerSelect").value;
            if (!name) {
              setMsg("Team name required");
              return;
            }
            try {
              await axios.post(
                `${API}/api/teams`,
                { name, manager_id: managerId || null },
                { headers: getHeaders() }
              );
              setMsg("✓ Team created!");
              document.getElementById("teamNameInput").value = "";
              document.getElementById("managerSelect").value = "";
              await loadTeams();
            } catch (e) {
              setMsg("Error: " + (e.response?.data?.error || e.message));
            }
          }}
          style={{
            background: "#1a6b3c",
            color: "white",
            padding: 8,
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Create Team
        </button>
      </div>
      {msg && (
        <span
          style={{
            fontSize: 12,
            color: msg.includes("✓") ? "#1a6b3c" : "#dc2626",
          }}
        >
          {msg}
        </span>
      )}
    </div>
    <button
      onClick={loadTeams}
      style={{
        padding: 8,
        marginBottom: 15,
        background: "#1a6b3c",
        color: "white",
        border: "none",
        borderRadius: 4,
        cursor: "pointer",
      }}
    >
      Load Teams
    </button>
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        background: "white",
        borderRadius: 8,
      }}
    >
      <thead>
        <tr
          style={{
            background: "#f3f4f6",
            borderBottom: "1px solid #e5e7eb",
          }}
        >
          <th
            style={{
              padding: 12,
              textAlign: "left",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Team Name
          </th>
          <th
            style={{
              padding: 12,
              textAlign: "left",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Manager
          </th>
          <th
            style={{
              padding: 12,
              textAlign: "left",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Actions
          </th>
        </tr>
      </thead>
      <tbody>
        {teams.map((t, i) => (
          <tr key={t.id || i} style={{ borderBottom: "1px solid #e5e7eb" }}>
            <td style={{ padding: 12 }}>{t.name}</td>
            <td style={{ padding: 12 }}>{t.manager?.full_name || "—"}</td>
            <td style={{ padding: 12 }}>
              <button
                onClick={() => editTeam(t)}
                style={{
                  marginRight: 6, padding: "4px 10px", fontSize: 12,
                  background: "#2563eb", color: "white", border: "none",
                  borderRadius: 4, cursor: "pointer",
                }}
              >
                Edit
              </button>
              <button
                onClick={() => deleteTeam(t)}
                style={{
                  padding: "4px 10px", fontSize: 12,
                  background: "#dc2626", color: "white", border: "none",
                  borderRadius: 4, cursor: "pointer",
                }}
              >
                Delete
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)}

        {page === "rates" && (
          <div>
            {/* Feature Premiums editor (admin/manager) */}
            {featureDefs.length > 0 && (auth?.user?.role === "admin" || auth?.user?.role === "manager") && (
              <div style={{ background: "white", padding: 20, borderRadius: 8, marginBottom: 20, border: "1px solid #e5e7eb" }}>
                <h3 style={{ marginTop: 0 }}>Feature Premiums (%)</h3>
                <p style={{ fontSize: 12, color: "#6b7280", marginTop: 0 }}>
                  These percentages are added to a plot's base price when that feature is checked. Extra Land has no % (priced separately).
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                  {featureDefs.filter((d) => d.input_type === "checkbox" && d.key !== "extra_land").map((d) => (
                    <div key={d.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <label style={{ fontSize: 13, minWidth: 90 }}>{d.label}</label>
                      <input
                        type="number"
                        defaultValue={d.premium_percent}
                        step="0.5"
                        onBlur={(e) => {
                          if (parseFloat(e.target.value) !== Number(d.premium_percent)) {
                            updatePremium(d.key, e.target.value);
                          }
                        }}
                        style={{ width: 70, padding: 6, border: "1px solid #ccc", borderRadius: 4 }}
                      />
                      <span style={{ fontSize: 13, color: "#6b7280" }}>%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div
              style={{
                background: "white",
                padding: 20,
                borderRadius: 8,
                marginBottom: 20,
                border: "1px solid #e5e7eb",
              }}
            >
              <h3>Add Plot Rate</h3>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                  marginBottom: 10,
                }}
              >
                <input
                  type="text"
                  placeholder="Sector (e.g. K)"
                  value={rateForm.sector}
                  onChange={(e) =>
                    setRateForm({ ...rateForm, sector: e.target.value })
                  }
                  style={{
                    padding: 8,
                    border: "1px solid #ccc",
                    borderRadius: 4,
                  }}
                />
                <input
                  type="text"
                  placeholder="Sub-category / Area (e.g. M1)"
                  value={rateForm.sub_category}
                  onChange={(e) =>
                    setRateForm({ ...rateForm, sub_category: e.target.value })
                  }
                  style={{
                    padding: 8,
                    border: "1px solid #ccc",
                    borderRadius: 4,
                  }}
                />
                <select
                  value={rateForm.type}
                  onChange={(e) =>
                    setRateForm({ ...rateForm, type: e.target.value })
                  }
                  style={{
                    padding: 8,
                    border: "1px solid #ccc",
                    borderRadius: 4,
                  }}
                >
                  <option value="residential">Residential</option>
                  <option value="commercial">Commercial</option>
                </select>
                <input
                  type="text"
                  placeholder="Size (e.g. 1 Kanal)"
                  value={rateForm.size}
                  onChange={(e) =>
                    setRateForm({ ...rateForm, size: e.target.value })
                  }
                  style={{
                    padding: 8,
                    border: "1px solid #ccc",
                    borderRadius: 4,
                  }}
                />
                <input
                  type="number"
                  placeholder="Plot From"
                  value={rateForm.from}
                  onChange={(e) =>
                    setRateForm({ ...rateForm, from: e.target.value })
                  }
                  style={{
                    padding: 8,
                    border: "1px solid #ccc",
                    borderRadius: 4,
                  }}
                />
                <input
                  type="number"
                  placeholder="Plot To"
                  value={rateForm.to}
                  onChange={(e) =>
                    setRateForm({ ...rateForm, to: e.target.value })
                  }
                  style={{
                    padding: 8,
                    border: "1px solid #ccc",
                    borderRadius: 4,
                  }}
                />
                <input
                  type="number"
                  placeholder="Min (Lakhs)"
                  value={rateForm.min}
                  onChange={(e) => {
                    const f = { ...rateForm, min: e.target.value };
                    setRateForm(f);
                    computePreview(f, featureDefs);
                  }}
                  step="0.5"
                  style={{
                    padding: 8,
                    border: "1px solid #ccc",
                    borderRadius: 4,
                  }}
                />
                <input
                  type="number"
                  placeholder="Max (Lakhs)"
                  value={rateForm.max}
                  onChange={(e) => {
                    const f = { ...rateForm, max: e.target.value };
                    setRateForm(f);
                    computePreview(f, featureDefs);
                  }}
                  step="0.5"
                  style={{
                    padding: 8,
                    border: "1px solid #ccc",
                    borderRadius: 4,
                  }}
                />
                <input
                  type="text"
                  placeholder="Notes (optional)"
                  value={rateForm.notes}
                  onChange={(e) =>
                    setRateForm({ ...rateForm, notes: e.target.value })
                  }
                  style={{
                    padding: 8,
                    border: "1px solid #ccc",
                    borderRadius: 4,
                    gridColumn: "1 / -1",
                  }}
                />
              </div>

              {/* Feature checkboxes + live price preview */}
              {featureDefs.length > 0 && (
                <div style={{ marginTop: 14, padding: 14, background: "#f9fafb", borderRadius: 6, border: "1px solid #e5e7eb" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Plot Features</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                    {featureDefs.filter((d) => d.input_type === "checkbox" && d.label && d.label.trim()).map((d) => (
                      <label key={d.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={!!rateForm.features?.[d.key]}
                          onChange={() => toggleFeature(d.key)}
                        />
                        {d.label}
                        {d.key !== "extra_land" && (
                          <span style={{ color: "#6b7280", fontSize: 12 }}>(+{d.premium_percent}%)</span>
                        )}
                      </label>
                    ))}
                  </div>

                  {/* Select-type features (e.g. Road Width) */}
                  {featureDefs.filter((d) => d.input_type === "select").map((d) => {
                    let opts = [];
                    const raw = d.options;
                    try {
                      if (!raw) {
                        opts = [];
                      } else if (typeof raw === "object") {
                        opts = Array.isArray(raw) ? raw : Object.keys(raw);
                      } else {
                        const s = String(raw).trim();
                        if (s.startsWith("[") || s.startsWith("{")) {
                          const parsed = JSON.parse(s);
                          opts = Array.isArray(parsed) ? parsed : Object.keys(parsed);
                        } else {
                          opts = s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
                        }
                      }
                    } catch {
                      opts = String(raw || "").split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
                    }
                    // Normalize: each option may be a string or {label,value}
                    opts = opts.map((o) => (typeof o === "object" ? (o.label || o.value || JSON.stringify(o)) : o));
                    return (
                      <div key={d.key} style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
                        <label style={{ fontSize: 13, minWidth: 90 }}>{d.label}:</label>
                        <select
                          value={rateForm.features?.[d.key] || ""}
                          onChange={(e) => {
                            const next = { ...rateForm, features: { ...rateForm.features, [d.key]: e.target.value } };
                            setRateForm(next);
                            computePreview(next, featureDefs);
                          }}
                          style={{ padding: 6, border: "1px solid #ccc", borderRadius: 4 }}
                        >
                          <option value="">— Select —</option>
                          {opts.map((o) => (
                            <option key={o} value={o}>{o}</option>
                          ))}
                        </select>
                        {opts.length === 0 && (
                          <span style={{ fontSize: 11, color: "#d97706" }}>
                            No options set — add them in Settings
                          </span>
                        )}
                      </div>
                    );
                  })}

                  {pricePreview && (
                    <div style={{ marginTop: 12, padding: 10, background: "white", borderRadius: 6, border: "1px solid #d1fae5" }}>
                      <div style={{ fontSize: 13 }}>
                        Estimated with features{pricePreview.totalPct > 0 ? ` (+${pricePreview.totalPct}%)` : ""}:{" "}
                        <strong style={{ color: "#1a6b3c" }}>
                          Rs {pricePreview.min}L – {pricePreview.max}L
                        </strong>
                      </div>
                      {pricePreview.extraLand && (
                        <div style={{ fontSize: 12, color: "#d97706", marginTop: 4 }}>
                          ⚠️ Extra land is priced separately at purchase time (not included above).
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={saveRate}
                style={{
                  background: "#1a6b3c",
                  color: "white",
                  padding: 8,
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  marginRight: 10,
                }}
              >
                {editingRateId ? "Update Rate" : "Save Rate"}
              </button>
              {editingRateId && (
                <button
                  onClick={cancelEditRate}
                  style={{
                    background: "#6b7280",
                    color: "white",
                    padding: 8,
                    border: "none",
                    borderRadius: 4,
                    cursor: "pointer",
                    marginRight: 10,
                  }}
                >
                  Cancel Edit
                </button>
              )}
              <button
                onClick={downloadTemplate}
                style={{
                  background: "#1d4ed8",
                  color: "white",
                  padding: 8,
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                ⬇ Template
              </button>
              {msg && (
                <span
                  style={{
                    marginLeft: 15,
                    fontSize: 13,
                    color: msg.includes("✓") ? "#1a6b3c" : "#dc2626",
                  }}
                >
                  {msg}
                </span>
              )}
            </div>

            {excelData.length > 0 && (
              <div
                style={{
                  background: "white",
                  padding: 20,
                  borderRadius: 8,
                  marginBottom: 20,
                  border: "1px solid #e5e7eb",
                }}
              >
                <h3>Excel Preview ({excelData.length} rows)</h3>
                <button
                  onClick={importExcel}
                  disabled={loading}
                  style={{
                    background: loading ? "#ccc" : "#1a6b3c",
                    color: "white",
                    padding: 8,
                    border: "none",
                    borderRadius: 4,
                    cursor: loading ? "not-allowed" : "pointer",
                    marginBottom: 10,
                  }}
                >
                  {loading ? "Importing..." : "Import All"}
                </button>
              </div>
            )}

            <div
              style={{
                background: "white",
                padding: 20,
                borderRadius: 8,
                border: "1px solid #e5e7eb",
                marginBottom: 20,
              }}
            >
              <h3 style={{ marginBottom: 15 }}>Upload Excel</h3>
              <input
                type="file"
                accept=".xlsx"
                onChange={(e) =>
                  e.target.files[0] && handleExcelFile(e.target.files[0])
                }
                style={{ padding: 8, borderRadius: 4 }}
              />
            </div>

            <div>
              <button
                onClick={loadRates}
                style={{
                  padding: 8,
                  background: "#1a6b3c",
                  color: "white",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  marginBottom: 15,
                }}
              >
                Load All Rates
              </button>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  background: "white",
                  borderRadius: 8,
                }}
              >
                <thead>
                  <tr
                    style={{
                      background: "#f3f4f6",
                      borderBottom: "1px solid #e5e7eb",
                    }}
                  >
                    <th
                      style={{
                        padding: 12,
                        textAlign: "left",
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      Sector
                    </th>
                    <th
                      style={{
                        padding: 12,
                        textAlign: "left",
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      Type
                    </th>
                    <th
                      style={{
                        padding: 12,
                        textAlign: "left",
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      Size
                    </th>
                    <th
                      style={{
                        padding: 12,
                        textAlign: "left",
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      Min
                    </th>
                    <th
                      style={{
                        padding: 12,
                        textAlign: "left",
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      Max
                    </th>
                    <th
                      style={{
                        padding: 12,
                        textAlign: "left",
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rates.map((r, i) => (
                    <tr key={r.id || i} style={{ borderBottom: "1px solid #e5e7eb" }}>
                      <td style={{ padding: 12 }}>Sector {r.sector}{r.sub_category ? ` (${r.sub_category})` : ""}</td>
                      <td style={{ padding: 12 }}>{r.plot_type}</td>
                      <td style={{ padding: 12 }}>{r.size}</td>
                      <td
                        style={{
                          padding: 12,
                          color: "#1a6b3c",
                          fontWeight: 600,
                        }}
                      >
                        Rs {r.min_price / 100000}L
                      </td>
                      <td
                        style={{
                          padding: 12,
                          color: "#1a6b3c",
                          fontWeight: 600,
                        }}
                      >
                        Rs {r.max_price / 100000}L
                      </td>
                      <td style={{ padding: 12 }}>
                        <button
                          onClick={() => editRate(r)}
                          style={{
                            marginRight: 6, padding: "4px 10px", fontSize: 12,
                            background: "#2563eb", color: "white", border: "none",
                            borderRadius: 4, cursor: "pointer",
                          }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteRate(r.id)}
                          style={{
                            padding: "4px 10px", fontSize: 12,
                            background: "#dc2626", color: "white", border: "none",
                            borderRadius: 4, cursor: "pointer",
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {page === "projects" && (
          <div>
            <h1 style={{ fontSize: 24, marginBottom: 20 }}>Projects</h1>
            <div style={{ display: "flex", gap: 8, marginBottom: 20, maxWidth: 500 }}>
              <input
                value={newProject}
                onChange={(e) => setNewProject(e.target.value)}
                placeholder="New project name"
                style={{ flex: 1, padding: 10, border: "1px solid #d1d5db", borderRadius: 4 }}
              />
              <button
                onClick={addProject}
                style={{ padding: "10px 20px", background: "#1a6b3c", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}
              >
                Add
              </button>
            </div>
            <div style={{ background: "white", borderRadius: 8, padding: 16, maxWidth: 600 }}>
              {projects.length === 0 ? (
                <p style={{ color: "#6b7280" }}>No projects yet.</p>
              ) : (
                projects.map((p) => (
                  <div key={p.id} style={{ padding: 12, borderBottom: "1px solid #e5e7eb" }}>
                    {p.name}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {page === "company" && (
          <div style={{ maxWidth: 600 }}>
            <h1 style={{ fontSize: 24, marginBottom: 20 }}>Company Info</h1>
            <div style={{ background: "white", borderRadius: 8, padding: 20 }}>
              {[
                { key: "name", label: "Company Name" },
                { key: "website", label: "Website" },
                { key: "phone", label: "Phone" },
                { key: "email", label: "Email" },
                { key: "address", label: "Address" },
              ].map((f) => (
                <div key={f.key} style={{ marginBottom: 14 }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{f.label}</label>
                  <input
                    value={company[f.key]}
                    onChange={(e) => setCompany({ ...company, [f.key]: e.target.value })}
                    style={{ width: "100%", padding: 10, border: "1px solid #d1d5db", borderRadius: 4 }}
                  />
                </div>
              ))}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  About / Knowledge (the bot uses this)
                </label>
                <textarea
                  value={company.about}
                  onChange={(e) => setCompany({ ...company, about: e.target.value })}
                  rows={6}
                  style={{ width: "100%", padding: 10, border: "1px solid #d1d5db", borderRadius: 4, fontFamily: "inherit" }}
                />
              </div>
              <button
                onClick={saveCompany}
                style={{ padding: "10px 24px", background: "#1a6b3c", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}
              >
                Save Company Info
              </button>
            </div>
          </div>
        )}

        {page === "settings" && (
          <div style={{ maxWidth: 800 }}>
            {/* SLA + Assignment */}
            <div style={{ background: "white", padding: 20, borderRadius: 8, marginBottom: 20, border: "1px solid #e5e7eb" }}>
              <h3 style={{ marginTop: 0 }}>SLA & Assignment</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    Agent reminder after (minutes)
                  </label>
                  <input
                    type="number"
                    defaultValue={settings.sla_agent_reminder_minutes || "10"}
                    onBlur={(e) => saveSettings({ sla_agent_reminder_minutes: e.target.value })}
                    style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 4 }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    Escalate to manager after (minutes)
                  </label>
                  <input
                    type="number"
                    defaultValue={settings.sla_manager_escalate_minutes || "30"}
                    onBlur={(e) => saveSettings({ sla_manager_escalate_minutes: e.target.value })}
                    style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 4 }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    Assignment strategy
                  </label>
                  <select
                    value={settings.assignment_strategy || "round_robin"}
                    onChange={(e) => saveSettings({ assignment_strategy: e.target.value })}
                    style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 4 }}
                  >
                    <option value="round_robin">Round Robin (least-loaded agent)</option>
                    <option value="random">Random</option>
                  </select>
                </div>
              </div>
              <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 10 }}>
                Changes save automatically when you click away from a field.
              </p>
            </div>

            {/* Feature management */}
            <div style={{ background: "white", padding: 20, borderRadius: 8, marginBottom: 20, border: "1px solid #e5e7eb" }}>
              <h3 style={{ marginTop: 0 }}>Plot Features</h3>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f9fafb", textAlign: "left" }}>
                    <th style={{ padding: 8 }}>Label</th>
                    <th style={{ padding: 8 }}>Key</th>
                    <th style={{ padding: 8 }}>Type</th>
                    <th style={{ padding: 8 }}>Premium %</th>
                    <th style={{ padding: 8 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {featureDefs.map((d) => (
                    <tr key={d.key} style={{ borderBottom: "1px solid #eee" }}>
                      <td style={{ padding: 8 }}>{d.label}</td>
                      <td style={{ padding: 8, color: "#6b7280", fontFamily: "monospace" }}>{d.key}</td>
                      <td style={{ padding: 8 }}>{d.input_type}</td>
                      <td style={{ padding: 8 }}>
                        {d.input_type === "select" || d.key === "extra_land" ? (
                          <span style={{ color: "#9ca3af" }}>—</span>
                        ) : (
                          <input
                            type="number"
                            defaultValue={d.premium_percent}
                            step="0.5"
                            onBlur={(e) => {
                              if (parseFloat(e.target.value) !== Number(d.premium_percent)) {
                                updatePremium(d.key, e.target.value);
                              }
                            }}
                            style={{ width: 70, padding: 4, border: "1px solid #ccc", borderRadius: 4 }}
                          />
                        )}
                      </td>
                      <td style={{ padding: 8 }}>
                        <button
                          onClick={() => deleteFeatureDef(d.key)}
                          style={{ padding: "3px 10px", fontSize: 12, background: "#dc2626", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Add feature */}
            <div style={{ background: "white", padding: 20, borderRadius: 8, border: "1px solid #e5e7eb" }}>
              <h3 style={{ marginTop: 0 }}>Add Feature</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                <input placeholder="Label (e.g. Corner Plot)" value={newFeature.label}
                  onChange={(e) => setNewFeature({ ...newFeature, label: e.target.value })}
                  style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }} />
                <input placeholder="Key (e.g. corner — no spaces)" value={newFeature.key}
                  onChange={(e) => setNewFeature({ ...newFeature, key: e.target.value.toLowerCase().replace(/\s+/g, "_") })}
                  style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }} />
                <select value={newFeature.input_type}
                  onChange={(e) => setNewFeature({ ...newFeature, input_type: e.target.value })}
                  style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }}>
                  <option value="checkbox">Checkbox (single %)</option>
                  <option value="select">Dropdown (options)</option>
                </select>
                {newFeature.input_type === "checkbox" ? (
                  <input type="number" placeholder="Premium %" value={newFeature.premium_percent}
                    onChange={(e) => setNewFeature({ ...newFeature, premium_percent: parseFloat(e.target.value) || 0 })}
                    style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }} />
                ) : (
                  <input placeholder="Options (comma separated, e.g. 30ft,40ft,60ft)" value={newFeature.options}
                    onChange={(e) => setNewFeature({ ...newFeature, options: e.target.value })}
                    style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }} />
                )}
              </div>
              <button onClick={() => saveFeatureDef(newFeature)}
                style={{ padding: "8px 20px", background: "#1a6b3c", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}>
                Add Feature
              </button>
              {msg && (
                <span style={{ marginLeft: 12, fontSize: 13, color: msg.includes("saved") || msg.includes("✓") ? "#1a6b3c" : "#dc2626" }}>
                  {msg}
                </span>
              )}
            </div>
          </div>
        )}

        {page === "inventory" && (
          <div style={{ maxWidth: 800 }}>
            <div style={{ background: "white", padding: 20, borderRadius: 8, marginBottom: 20, border: "1px solid #e5e7eb" }}>
              <h3 style={{ marginTop: 0 }}>Plots Data</h3>
              <p style={{ fontSize: 13, color: "#4b5563" }}>
                <strong>{invStats.total.toLocaleString()}</strong> plots currently loaded.
              </p>
              <p style={{ fontSize: 12, color: "#6b7280" }}>
                Upload your DHA plot sheet (Excel). Expected columns: Phase, Sector, Plot No, Plot Type,
                Plot Size, Corner, Nearby Road, Road Width, Park Face, Nearby Park. Re-uploading updates
                existing plots (matched by sector + plot no + size).
              </p>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                disabled={invImporting}
                onChange={(e) => importInventory(e.target.files[0])}
                style={{ marginTop: 8 }}
              />
              {invImporting && (
                <div style={{ marginTop: 12, color: "#d97706", fontSize: 13 }}>
                  Importing… {invResult ? `${invResult.inserted} so far` : ""}
                </div>
              )}
              {invResult && !invImporting && (
                <div style={{ marginTop: 12, padding: 10, background: "#f0fdf4", borderRadius: 6, fontSize: 13 }}>
                  ✓ Imported <strong>{invResult.inserted}</strong> of {invResult.total} rows.
                  {invResult.skipped > 0 && <span style={{ color: "#d97706" }}> ({invResult.skipped} skipped — missing sector/plot no)</span>}
                  {invResult.errors?.length > 0 && (
                    <div style={{ color: "#dc2626", marginTop: 6 }}>
                      {invResult.errors.length} batch error(s): {invResult.errors[0]}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Test plot resolution */}
            <div style={{ background: "white", padding: 20, borderRadius: 8, border: "1px solid #e5e7eb" }}>
              <h3 style={{ marginTop: 0 }}>Test Plot Lookup</h3>
              <p style={{ fontSize: 12, color: "#6b7280" }}>
                Check what the bot resolves for a plot — its features (from inventory) and price band (from rates).
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <input placeholder="Sector (e.g. P)" value={resolveQuery.sector}
                  onChange={(e) => setResolveQuery({ ...resolveQuery, sector: e.target.value })}
                  style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4, width: 120 }} />
                <input placeholder="Plot No" value={resolveQuery.plot_no}
                  onChange={(e) => setResolveQuery({ ...resolveQuery, plot_no: e.target.value })}
                  style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4, width: 120 }} />
                <input placeholder="Size (optional)" value={resolveQuery.size}
                  onChange={(e) => setResolveQuery({ ...resolveQuery, size: e.target.value })}
                  style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4, width: 140 }} />
                <button onClick={resolvePlot}
                  style={{ padding: "8px 20px", background: "#1a6b3c", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}>
                  Look up
                </button>
              </div>
              {resolveResult && (
                <div style={{ padding: 12, background: "#f9fafb", borderRadius: 6, fontSize: 13 }}>
                  {resolveResult.plot ? (
                    <div>
                      <strong>Plot found:</strong> Sector {resolveResult.plot.sector}, Plot {resolveResult.plot.plot_no}, {resolveResult.plot.plot_size}<br />
                      Features: {Object.keys(resolveResult.plot.features || {}).join(", ") || "none"}<br />
                      {resolveResult.plot.nearby_road && <span>Near: {resolveResult.plot.nearby_road}<br /></span>}
                    </div>
                  ) : (
                    <div style={{ color: "#d97706" }}>Plot not found in inventory.</div>
                  )}
                  {resolveResult.band ? (
                    <div style={{ marginTop: 6 }}>
                      <strong>Price band:</strong> Rs {resolveResult.band.min_price / 100000}L – {resolveResult.band.max_price / 100000}L
                      {resolveResult.band.sub_category && ` (${resolveResult.band.sub_category})`}
                    </div>
                  ) : (
                    <div style={{ color: "#d97706", marginTop: 6 }}>No price band covers this plot number.</div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}