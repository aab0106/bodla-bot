import React, { useState, useEffect } from "react";
import axios from "axios";
import { createClient } from "@supabase/supabase-js";

// Supabase client for direct Storage uploads (anon key is browser-safe, guarded by RLS).
const supaUrl = import.meta.env.VITE_SUPABASE_URL;
const supaAnon = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supa = supaUrl && supaAnon ? createClient(supaUrl, supaAnon) : null;

// Manages bot-shareable documents. Used on Company page (projectId null) and
// each Project detail page (projectId set).
export default function DocumentManager({ API, getHeaders, projectId = null, setMsg }) {
  const [docs, setDocs] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ title: "", category: projectId ? "brochure" : "payment_plan", keywords: "" });

  const CATEGORIES = projectId
    ? [["brochure", "Brochure"], ["floor_map", "Floor Map"], ["payment_plan", "Payment Plan"], ["general", "Other"]]
    : [["payment_plan", "Payment Plan"], ["dha", "DHA Document"], ["brochure", "Brochure"], ["general", "Other"]];

  const load = async () => {
    try {
      const params = projectId ? { project_id: projectId } : { company: "true" };
      const { data } = await axios.get(`${API}/api/documents`, { headers: getHeaders(), params });
      setDocs(data || []);
    } catch (e) { /* non-critical */ }
  };

  useEffect(() => { load(); }, [projectId]);

  const handleUpload = async (file) => {
    if (!file) return;
    if (!supa) { setMsg("Storage not configured — add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY"); return; }
    if (!form.title.trim()) { setMsg("Enter a document title first"); return; }
    setUploading(true);
    setMsg("Uploading...");
    try {
      const ext = file.name.split(".").pop();
      const path = `${projectId || "company"}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supa.storage.from("documents").upload(path, file, { upsert: false });
      if (upErr) throw new Error(upErr.message);
      const { data: pub } = supa.storage.from("documents").getPublicUrl(path);
      await axios.post(`${API}/api/documents`, {
        title: form.title,
        category: form.category,
        file_url: pub.publicUrl,
        file_type: ext,
        project_id: projectId,
        keywords: form.keywords,
      }, { headers: getHeaders() });
      setMsg("✓ Document uploaded");
      setForm({ title: "", category: form.category, keywords: "" });
      load();
    } catch (e) {
      setMsg("Upload error: " + (e.message || "failed"));
    }
    setUploading(false);
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this document?")) return;
    try {
      await axios.delete(`${API}/api/documents/${id}`, { headers: getHeaders() });
      load();
    } catch (e) { setMsg("Error: " + (e.response?.data?.error || e.message)); }
  };

  const inputStyle = { padding: 8, border: "1px solid #ccc", borderRadius: 4 };

  return (
    <div style={{ background: "white", padding: 20, borderRadius: 8, border: "1px solid #e5e7eb", marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>Documents {projectId ? "" : "(company-wide)"}</h3>
      <p style={{ fontSize: 12, color: "#6b7280", marginTop: 0 }}>
        Upload payment plans, brochures, floor maps. The bot sends these as WhatsApp attachments when a client asks.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input placeholder="Document title (e.g. Bodla Homes payment plan)" value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })} style={{ ...inputStyle, width: 240 }} />
        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={inputStyle}>
          {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input placeholder="Keywords (payment, qist, installment)" value={form.keywords}
          onChange={(e) => setForm({ ...form, keywords: e.target.value })} style={{ ...inputStyle, width: 200 }} />
        <label style={{ padding: "8px 14px", background: uploading ? "#9ca3af" : "#1a6b3c", color: "white", borderRadius: 4, cursor: uploading ? "default" : "pointer", fontSize: 13 }}>
          {uploading ? "Uploading..." : "Choose & Upload"}
          <input type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={uploading} style={{ display: "none" }}
            onChange={(e) => { handleUpload(e.target.files[0]); e.target.value = ""; }} />
        </label>
      </div>

      {docs.length === 0 ? (
        <div style={{ fontSize: 13, color: "#9ca3af" }}>No documents yet.</div>
      ) : (
        docs.map((d) => (
          <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
            <div>
              <a href={d.file_url} target="_blank" rel="noreferrer" style={{ fontWeight: 600, fontSize: 14, color: "#1a6b3c" }}>{d.title}</a>
              <span style={{ fontSize: 12, color: "#6b7280", marginLeft: 8 }}>{d.category}{d.file_type ? ` · ${d.file_type}` : ""}</span>
            </div>
            <button onClick={() => remove(d.id)} style={{ padding: "3px 10px", fontSize: 11, background: "#dc2626", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}>Delete</button>
          </div>
        ))
      )}
    </div>
  );
}