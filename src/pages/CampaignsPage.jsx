import React, { useState, useEffect } from "react";
import axios from "axios";

// Campaigns: ad-driven temporary products (e.g. Premium Homes) with a toggle
// and per-size payment options. When a lead's message contains trigger_text,
// the bot focuses only on that campaign.
export default function CampaignsPage({ API, getHeaders, setMsg, msg, role }) {
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ id: null, name: "", active: true, trigger_text: "", description: "", details: "", brochure_url: "" });
  const [optForm, setOptForm] = useState({ label: "", total_price: "", down_payment: "", installment: "", installments: "", on_possession: "", notes: "" });
  const [openId, setOpenId] = useState(null);

  const canEdit = role === "admin" || role === "manager";

  const load = async () => {
    try {
      const { data } = await axios.get(`${API}/api/campaigns`, { headers: getHeaders() });
      setList(data || []);
    } catch (e) { /* non-critical */ }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name.trim()) { setMsg("Campaign name required"); return; }
    try {
      await axios.post(`${API}/api/campaigns`, form, { headers: getHeaders() });
      setMsg(form.id ? "Campaign updated" : "Campaign added");
      setForm({ id: null, name: "", active: true, trigger_text: "", description: "", details: "", brochure_url: "" });
      load();
    } catch (e) { setMsg("Error: " + (e.response?.data?.error || e.message)); }
  };

  const edit = (c) => {
    setForm({ id: c.id, name: c.name || "", active: c.active, trigger_text: c.trigger_text || "", description: c.description || "", details: c.details || "", brochure_url: c.brochure_url || "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleActive = async (c) => {
    try {
      await axios.post(`${API}/api/campaigns`, { ...c, active: !c.active }, { headers: getHeaders() });
      load();
    } catch (e) { setMsg("Error: " + (e.response?.data?.error || e.message)); }
  };

  const del = async (id) => {
    if (!window.confirm("Delete this campaign?")) return;
    try { await axios.delete(`${API}/api/campaigns/${id}`, { headers: getHeaders() }); load(); }
    catch (e) { setMsg("Error: " + (e.response?.data?.error || e.message)); }
  };

  const toRs = (v) => v ? Math.round(parseFloat(v) * 100000) : null;

  const addOption = async (campaignId) => {
    if (!optForm.label.trim()) { setMsg("Option label required"); return; }
    try {
      await axios.post(`${API}/api/campaigns/${campaignId}/options`, {
        label: optForm.label,
        total_price: toRs(optForm.total_price),
        down_payment: toRs(optForm.down_payment),
        installment: toRs(optForm.installment),
        installments: optForm.installments ? parseInt(optForm.installments) : null,
        on_possession: toRs(optForm.on_possession),
        notes: optForm.notes || null,
      }, { headers: getHeaders() });
      setOptForm({ label: "", total_price: "", down_payment: "", installment: "", installments: "", on_possession: "", notes: "" });
      load();
    } catch (e) { setMsg("Error: " + (e.response?.data?.error || e.message)); }
  };

  const delOption = async (optId) => {
    try { await axios.delete(`${API}/api/campaigns/options/${optId}`, { headers: getHeaders() }); load(); }
    catch (e) { setMsg("Error: " + (e.response?.data?.error || e.message)); }
  };

  const inp = { padding: 8, border: "1px solid #ccc", borderRadius: 4, boxSizing: "border-box" };
  const fmtL = (v) => v ? `${(v / 100000).toFixed(1)}L` : "—";

  return (
    <div style={{ maxWidth: 900 }}>
      {canEdit && (
        <div style={{ background: "white", padding: 20, borderRadius: 8, marginBottom: 20, border: "1px solid #e5e7eb" }}>
          <h3 style={{ marginTop: 0 }}>{form.id ? "Edit Campaign" : "Add Campaign"}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <input placeholder="Campaign name (e.g. Premium Homes)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inp} />
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Active (bot focuses on this when triggered)
            </label>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Trigger text (the form's opening line the lead sends)</label>
            <input placeholder='e.g. I filled out your form and would like to know more' value={form.trigger_text} onChange={(e) => setForm({ ...form, trigger_text: e.target.value })} style={{ ...inp, width: "100%" }} />
            <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>When an incoming message contains this text, the bot talks only about this campaign.</div>
          </div>
          <textarea placeholder="Short description (what the bot leads with)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} style={{ ...inp, width: "100%", marginBottom: 10, fontFamily: "inherit" }} />
          <textarea placeholder="Full details — location, features, amenities, payment notes" value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} rows={4} style={{ ...inp, width: "100%", marginBottom: 10, fontFamily: "inherit" }} />
          <input placeholder="Brochure URL (optional)" value={form.brochure_url} onChange={(e) => setForm({ ...form, brochure_url: e.target.value })} style={{ ...inp, width: "100%", marginBottom: 10 }} />
          <button onClick={save} style={{ padding: "8px 20px", background: "#1a6b3c", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}>
            {form.id ? "Update Campaign" : "Add Campaign"}
          </button>
          {form.id && <button onClick={() => setForm({ id: null, name: "", active: true, trigger_text: "", description: "", details: "", brochure_url: "" })} style={{ marginLeft: 8, padding: "8px 20px", background: "#6b7280", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}>Cancel</button>}
          {msg && <span style={{ marginLeft: 12, fontSize: 13, color: msg.includes("Error") ? "#dc2626" : "#1a6b3c" }}>{msg}</span>}
        </div>
      )}

      {list.length === 0 ? (
        <p style={{ color: "#6b7280" }}>No campaigns yet.</p>
      ) : list.map((c) => (
        <div key={c.id} style={{ background: "white", padding: 16, borderRadius: 8, marginBottom: 14, border: "1px solid #e5e7eb" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
            <div>
              <strong style={{ fontSize: 16 }}>{c.name}</strong>
              <span style={{ marginLeft: 8, fontSize: 11, padding: "2px 10px", borderRadius: 10, background: c.active ? "#dcfce7" : "#fee2e2", color: c.active ? "#166534" : "#991b1b" }}>
                {c.active ? "ACTIVE" : "OFF"}
              </span>
              {c.trigger_text && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>Trigger: "{c.trigger_text}"</div>}
            </div>
            {canEdit && (
              <div style={{ whiteSpace: "nowrap" }}>
                <button onClick={() => toggleActive(c)} style={{ marginRight: 4, padding: "4px 10px", fontSize: 12, background: c.active ? "#d97706" : "#16a34a", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}>
                  {c.active ? "Turn Off" : "Turn On"}
                </button>
                <button onClick={() => edit(c)} style={{ marginRight: 4, padding: "4px 10px", fontSize: 12, background: "#2563eb", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}>Edit</button>
                {role === "admin" && <button onClick={() => del(c.id)} style={{ padding: "4px 10px", fontSize: 12, background: "#dc2626", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}>Delete</button>}
              </div>
            )}
          </div>

          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #f3f4f6" }}>
            {(c.options || []).length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 10 }}>
                <thead>
                  <tr style={{ background: "#f9fafb", textAlign: "left" }}>
                    <th style={{ padding: 6 }}>Option</th><th style={{ padding: 6 }}>Total</th><th style={{ padding: 6 }}>Down</th>
                    <th style={{ padding: 6 }}>Installment</th><th style={{ padding: 6 }}>#</th><th style={{ padding: 6 }}>Possession</th><th style={{ padding: 6 }}>Notes</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {c.options.map((o) => (
                    <tr key={o.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={{ padding: 6, fontWeight: 600 }}>{o.label}</td>
                      <td style={{ padding: 6 }}>{fmtL(o.total_price)}</td>
                      <td style={{ padding: 6 }}>{fmtL(o.down_payment)}</td>
                      <td style={{ padding: 6 }}>{fmtL(o.installment)}</td>
                      <td style={{ padding: 6 }}>{o.installments || "—"}</td>
                      <td style={{ padding: 6 }}>{fmtL(o.on_possession)}</td>
                      <td style={{ padding: 6, color: "#6b7280" }}>{o.notes || "—"}</td>
                      <td style={{ padding: 6 }}>{canEdit && <button onClick={() => delOption(o.id)} style={{ fontSize: 11, background: "none", border: "none", color: "#dc2626", cursor: "pointer" }}>✕</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {canEdit && (openId === c.id ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                <input placeholder="Label (10 Marla)" value={optForm.label} onChange={(e) => setOptForm({ ...optForm, label: e.target.value })} style={{ ...inp, width: 110 }} />
                <input placeholder="Total (L)" value={optForm.total_price} onChange={(e) => setOptForm({ ...optForm, total_price: e.target.value })} style={{ ...inp, width: 80 }} />
                <input placeholder="Down (L)" value={optForm.down_payment} onChange={(e) => setOptForm({ ...optForm, down_payment: e.target.value })} style={{ ...inp, width: 80 }} />
                <input placeholder="Instlmt (L)" value={optForm.installment} onChange={(e) => setOptForm({ ...optForm, installment: e.target.value })} style={{ ...inp, width: 85 }} />
                <input placeholder="# inst" value={optForm.installments} onChange={(e) => setOptForm({ ...optForm, installments: e.target.value })} style={{ ...inp, width: 60 }} />
                <input placeholder="Possession (L)" value={optForm.on_possession} onChange={(e) => setOptForm({ ...optForm, on_possession: e.target.value })} style={{ ...inp, width: 105 }} />
                <input placeholder="Notes" value={optForm.notes} onChange={(e) => setOptForm({ ...optForm, notes: e.target.value })} style={{ ...inp, width: 160 }} />
                <button onClick={() => addOption(c.id)} style={{ padding: "6px 12px", fontSize: 12, background: "#1a6b3c", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}>Add</button>
                <button onClick={() => setOpenId(null)} style={{ padding: "6px 12px", fontSize: 12, background: "#6b7280", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}>Done</button>
              </div>
            ) : (
              <button onClick={() => { setOpenId(c.id); setOptForm({ label: "", total_price: "", down_payment: "", installment: "", installments: "", on_possession: "", notes: "" }); }}
                style={{ padding: "4px 12px", fontSize: 12, background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: 4, cursor: "pointer" }}>
                + Add pricing option
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}