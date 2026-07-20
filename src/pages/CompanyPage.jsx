import React, { useState, useEffect } from "react";
import axios from "axios";

// Company Info page with sub-tabs. Profile fields live in App (company/setCompany/saveCompany).
// Knowledge entries (DHA / Fees / Links / FAQ) are managed here via the /api/knowledge endpoints.
export default function CompanyPage({ API, getHeaders, company, setCompany, saveCompany, setMsg, msg }) {
  const [tab, setTab] = useState("profile");
  const [entries, setEntries] = useState([]);
  const [form, setForm] = useState({ id: null, category: "dha", title: "", content: "", link_url: "" });

  const KNOWLEDGE_TABS = [
    { key: "dha", label: "DHA Info" },
    { key: "fees", label: "Fees & Charges" },
    { key: "links", label: "Links" },
    { key: "faq", label: "FAQ" },
  ];

  const loadEntries = async () => {
    try {
      const { data } = await axios.get(`${API}/api/knowledge`, { headers: getHeaders() });
      setEntries(data || []);
    } catch (e) { /* non-critical */ }
  };

  useEffect(() => { loadEntries(); }, []);

  const saveEntry = async () => {
    if (!form.title.trim()) { setMsg("Title is required"); return; }
    try {
      await axios.post(`${API}/api/knowledge`, { ...form, category: tab }, { headers: getHeaders() });
      setMsg("Saved");
      setForm({ id: null, category: tab, title: "", content: "", link_url: "" });
      loadEntries();
    } catch (e) {
      setMsg("Error: " + (e.response?.data?.error || e.message));
    }
  };

  const editEntry = (e) => setForm({ id: e.id, category: e.category, title: e.title, content: e.content || "", link_url: e.link_url || "" });

  const deleteEntry = async (id) => {
    if (!window.confirm("Delete this entry?")) return;
    try {
      await axios.delete(`${API}/api/knowledge/${id}`, { headers: getHeaders() });
      loadEntries();
    } catch (e) {
      setMsg("Error: " + (e.response?.data?.error || e.message));
    }
  };

  const tabStyle = (active) => ({
    padding: "8px 16px", cursor: "pointer", border: "none", borderRadius: 6,
    background: active ? "#1a6b3c" : "#f3f4f6", color: active ? "white" : "#374151",
    fontSize: 13, fontWeight: 600,
  });
  const inputStyle = { width: "100%", padding: 10, border: "1px solid #d1d5db", borderRadius: 4, boxSizing: "border-box" };

  const catEntries = entries.filter((e) => e.category === tab);

  return (
    <div style={{ maxWidth: 700 }}>
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <button style={tabStyle(tab === "profile")} onClick={() => setTab("profile")}>Company</button>
        {KNOWLEDGE_TABS.map((t) => (
          <button key={t.key} style={tabStyle(tab === t.key)} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {tab === "profile" ? (
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
              <input value={company[f.key] || ""} onChange={(e) => setCompany({ ...company, [f.key]: e.target.value })} style={inputStyle} />
            </div>
          ))}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>About (general company description)</label>
            <textarea value={company.about || ""} onChange={(e) => setCompany({ ...company, about: e.target.value })} rows={4} style={{ ...inputStyle, fontFamily: "inherit" }} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Policies & FAQ (free text — the bot answers from this)</label>
            <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>
              Transfer charges, possession, process, payment terms. For structured entries, use the tabs above.
            </div>
            <textarea value={company.knowledge || ""} onChange={(e) => setCompany({ ...company, knowledge: e.target.value })} rows={6} style={{ ...inputStyle, fontFamily: "inherit" }} />
          </div>
          <button onClick={saveCompany} style={{ padding: "10px 24px", background: "#1a6b3c", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}>
            Save Company Info
          </button>
          {msg && <span style={{ marginLeft: 12, fontSize: 13, color: "#1a6b3c" }}>{msg}</span>}
        </div>
      ) : (
        <div>
          <div style={{ background: "white", borderRadius: 8, padding: 20, marginBottom: 20 }}>
            <h3 style={{ marginTop: 0 }}>{form.id ? "Edit" : "Add"} {KNOWLEDGE_TABS.find((t) => t.key === tab)?.label} entry</h3>
            <p style={{ fontSize: 12, color: "#6b7280", marginTop: 0 }}>The bot answers clients directly from these entries.</p>
            <div style={{ marginBottom: 10 }}>
              <input placeholder={tab === "links" ? "Label (e.g. Company intro video)" : "Title / question (e.g. Transfer charges Sector A)"}
                value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={inputStyle} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <textarea placeholder={tab === "links" ? "Optional description" : "Answer / detail"}
                value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={3} style={{ ...inputStyle, fontFamily: "inherit" }} />
            </div>
            {(tab === "links" || tab === "dha") && (
              <div style={{ marginBottom: 10 }}>
                <input placeholder="Link URL (video, map, brochure, testimonial...)" value={form.link_url}
                  onChange={(e) => setForm({ ...form, link_url: e.target.value })} style={inputStyle} />
              </div>
            )}
            <button onClick={saveEntry} style={{ padding: "8px 20px", background: "#1a6b3c", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}>
              {form.id ? "Update" : "Add"}
            </button>
            {form.id && (
              <button onClick={() => setForm({ id: null, category: tab, title: "", content: "", link_url: "" })}
                style={{ marginLeft: 8, padding: "8px 20px", background: "#6b7280", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}>
                Cancel
              </button>
            )}
            {msg && <span style={{ marginLeft: 12, fontSize: 13, color: msg.includes("Error") ? "#dc2626" : "#1a6b3c" }}>{msg}</span>}
          </div>

          <div style={{ background: "white", borderRadius: 8, padding: 20 }}>
            {catEntries.length === 0 ? (
              <div style={{ color: "#9ca3af", fontSize: 13 }}>No entries yet in this section.</div>
            ) : (
              catEntries.map((e) => (
                <div key={e.id} style={{ padding: "10px 0", borderBottom: "1px solid #f3f4f6" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{e.title}</div>
                      {e.content && <div style={{ fontSize: 13, color: "#4b5563", marginTop: 2 }}>{e.content}</div>}
                      {e.link_url && <a href={e.link_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#2563eb" }}>{e.link_url}</a>}
                    </div>
                    <div style={{ whiteSpace: "nowrap", marginLeft: 10 }}>
                      <button onClick={() => editEntry(e)} style={{ marginRight: 4, padding: "3px 10px", fontSize: 11, background: "#2563eb", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}>Edit</button>
                      <button onClick={() => deleteEntry(e.id)} style={{ padding: "3px 10px", fontSize: 11, background: "#dc2626", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}>Delete</button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}