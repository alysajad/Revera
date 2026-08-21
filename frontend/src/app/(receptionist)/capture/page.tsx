"use client";

import { useEffect, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createLead, getSystemConfig, getOfficers, toOfficer, sourceName, type Officer, type SystemConfig } from "@/lib/crm";

const RIVER_MODELS = {
  "Indie": ["Standard", "Pro", "Custom"]
};

export default function CaptureLeadPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [officers, setOfficers] = useState<Officer[]>([]);

  const [sourceType, setSourceType] = useState<"Walk-in" | "Digital">("Walk-in");
  const [digitalSource, setDigitalSource] = useState("WEBSITE");

  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    profession: "",
    model_interest: "",
    variant: "",
    buying_timeline: "",
    assigned_ps_id: "",
  });

  useEffect(() => {
    getSystemConfig().then(setConfig).catch(console.error);
    getOfficers().then(apiOfficers => setOfficers(apiOfficers.map(o => toOfficer(o)))).catch(console.error);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => {
      const next = { ...prev, [name]: value };
      if (name === "model_interest") next.variant = ""; // reset variant when model changes
      return next;
    });
  };

  const handleClear = () => {
    setFormData({
      name: "", phone: "", email: "", profession: "",
      model_interest: "", variant: "", buying_timeline: "", assigned_ps_id: ""
    });
    setSourceType("Walk-in");
    setError("");
    setSuccess(false);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess(false);

    try {
      const payload = {
        name: formData.name,
        phone: formData.phone,
        email: formData.email || undefined,
        profession: formData.profession,
        source: sourceType === "Walk-in" ? "WALKIN" : digitalSource,
        model_interest: formData.model_interest,
        ps_officer_id: formData.assigned_ps_id ? parseInt(formData.assigned_ps_id) : undefined,
        qualification_input: {
          variant: formData.variant,
          buying_timeline: formData.buying_timeline,
          finance_type: "",
          test_drive: "",
          notes: ""
        }
      };
      
      const finalPayload = {
        ...payload,
        status: sourceType === "Walk-in" ? "WALKIN" : "FRESH"
      };

      await createLead(finalPayload as any);
      setSuccess(true);
      setTimeout(() => {
        handleClear();
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to capture lead.");
    } finally {
      setLoading(false);
    }
  };

  const availableVariants = formData.model_interest ? RIVER_MODELS[formData.model_interest as keyof typeof RIVER_MODELS] || [] : [];

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#F5F5DC", padding: "3rem 1rem", color: "#A0522D" }}>
      <div style={{ maxWidth: "800px", margin: "0 auto" }}>
        <div style={{ marginBottom: "2rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "2.5rem", fontWeight: "bold", color: "#A0522D", marginBottom: "0.5rem" }}>Capture New Lead</h1>
          <p style={{ color: "#E35336", fontSize: "1.1rem" }}>Register a new customer enquiry</p>
        </div>
        
        <form onSubmit={submit} style={{ backgroundColor: "#ffffff", padding: "2.5rem", borderRadius: "12px", boxShadow: "0 10px 30px rgba(160, 82, 45, 0.1)", border: "1px solid #F4A460" }}>
          {error && <div style={{ backgroundColor: "#ffeeee", color: "#E35336", padding: "1rem", borderRadius: "8px", marginBottom: "1.5rem", fontWeight: "500", border: "1px solid #E35336" }}>{error}</div>}
          {success && <div style={{ backgroundColor: "#e6fffa", color: "#2c7a7b", padding: "1rem", borderRadius: "8px", marginBottom: "1.5rem", fontWeight: "500", border: "1px solid #319795" }}>Lead successfully captured!</div>}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem", marginBottom: "2rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontWeight: "600", color: "#A0522D" }}>
              Customer Full Name *
              <input type="text" name="name" value={formData.name} onChange={handleChange} required placeholder="Enter customer name" style={{ padding: "0.75rem", borderRadius: "8px", border: "1px solid #F4A460", outline: "none", fontSize: "1rem", backgroundColor: "#F5F5DC" }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontWeight: "600", color: "#A0522D" }}>
              Mobile Number *
              <input type="tel" name="phone" value={formData.phone} onChange={handleChange} onInput={(e) => { e.currentTarget.value = e.currentTarget.value.replace(/\D/g, '').slice(0, 10); handleChange(e as any); }} required pattern="\d{10}" minLength={10} maxLength={10} placeholder="10-digit mobile number" style={{ padding: "0.75rem", borderRadius: "8px", border: "1px solid #F4A460", outline: "none", fontSize: "1rem", backgroundColor: "#F5F5DC" }} />
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem", marginBottom: "2rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontWeight: "600", color: "#A0522D" }}>
              Email Address (Optional)
              <input type="email" name="email" value={formData.email} onChange={handleChange} placeholder="customer@example.com" style={{ padding: "0.75rem", borderRadius: "8px", border: "1px solid #F4A460", outline: "none", fontSize: "1rem", backgroundColor: "#F5F5DC" }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontWeight: "600", color: "#A0522D" }}>
              Profession
              <input type="text" name="profession" value={formData.profession} onChange={handleChange} placeholder="Enter profession (optional)" style={{ padding: "0.75rem", borderRadius: "8px", border: "1px solid #F4A460", outline: "none", fontSize: "1rem", backgroundColor: "#F5F5DC" }} />
            </label>
          </div>


          <div style={{ marginBottom: "2rem" }}>
            <label style={{ display: "block", marginBottom: "0.75rem", fontWeight: "600", color: "#A0522D" }}>Source *</label>
            <div style={{ display: "flex", gap: "1.5rem" }}>
              <label style={{ flex: 1, padding: "1rem", border: `2px solid ${sourceType === "Walk-in" ? "#E35336" : "#F4A460"}`, borderRadius: "8px", background: sourceType === "Walk-in" ? "#F5F5DC" : "#ffffff", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.75rem", fontWeight: "600", color: "#A0522D", transition: "all 0.2s" }}>
                <input type="radio" checked={sourceType === "Walk-in"} onChange={() => setSourceType("Walk-in")} style={{ width: "1.2rem", height: "1.2rem", accentColor: "#E35336" }} />
                Walk-in
              </label>
              <label style={{ flex: 1, padding: "1rem", border: `2px solid ${sourceType === "Digital" ? "#E35336" : "#F4A460"}`, borderRadius: "8px", background: sourceType === "Digital" ? "#F5F5DC" : "#ffffff", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.75rem", fontWeight: "600", color: "#A0522D", transition: "all 0.2s" }}>
                <input type="radio" checked={sourceType === "Digital"} onChange={() => setSourceType("Digital")} style={{ width: "1.2rem", height: "1.2rem", accentColor: "#E35336" }} />
                Digital
              </label>
            </div>
            {sourceType === "Digital" && (
              <div style={{ marginTop: "1rem" }}>
                <select value={digitalSource} onChange={e => setDigitalSource(e.target.value)} required style={{ width: "100%", padding: "0.75rem", borderRadius: "8px", border: "1px solid #F4A460", outline: "none", fontSize: "1rem", backgroundColor: "#F5F5DC", color: "#A0522D", fontWeight: "500" }}>
                  {(config?.lists?.sources?.length ? config.lists.sources.filter(s => s !== "WALKIN") : ["META", "WEBSITE", "CARWALE", "CAMPAIGN", "OTHER"]).map(s => (
                    <option key={s} value={s}>{sourceName(s)}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem", marginBottom: "2rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontWeight: "600", color: "#A0522D" }}>
              River Model Interested *
              <select name="model_interest" value={formData.model_interest} onChange={handleChange} required style={{ padding: "0.75rem", borderRadius: "8px", border: "1px solid #F4A460", outline: "none", fontSize: "1rem", backgroundColor: "#F5F5DC", color: "#A0522D" }}>
                <option value="">Select model</option>
                {Object.keys(RIVER_MODELS).map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontWeight: "600", color: "#A0522D" }}>
              Variant *
              <select name="variant" value={formData.variant} onChange={handleChange} required disabled={!formData.model_interest} style={{ padding: "0.75rem", borderRadius: "8px", border: "1px solid #F4A460", outline: "none", fontSize: "1rem", backgroundColor: !formData.model_interest ? "#f0f0f0" : "#F5F5DC", color: "#A0522D" }}>
                <option value="">Select variant</option>
                {availableVariants.map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem", marginBottom: "2rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontWeight: "600", color: "#A0522D" }}>
              Purchase Timeline *
              <select name="buying_timeline" value={formData.buying_timeline} onChange={handleChange} required style={{ padding: "0.75rem", borderRadius: "8px", border: "1px solid #F4A460", outline: "none", fontSize: "1rem", backgroundColor: "#F5F5DC", color: "#A0522D" }}>
                <option value="">Select timeline</option>
                <option value="Immediate">Immediate (0-15 days)</option>
                <option value="Short Term">Short Term (1-2 months)</option>
                <option value="Long Term">Long Term (2+ months)</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontWeight: "600", color: "#A0522D" }}>
              Assign to Sales Executive (PS) *
              <select name="assigned_ps_id" value={formData.assigned_ps_id} onChange={handleChange} required style={{ padding: "0.75rem", borderRadius: "8px", border: "1px solid #F4A460", outline: "none", fontSize: "1rem", backgroundColor: "#F5F5DC", color: "#A0522D" }}>
                <option value="">Select Executive</option>
                {officers.map(o => (
                  <option key={o.id} value={o.id}>{o.name} ({o.location})</option>
                ))}
              </select>
            </label>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "1.5rem", marginTop: "3rem", borderTop: "1px solid #F5F5DC", paddingTop: "2rem" }}>
            <button type="button" onClick={handleClear} disabled={loading} style={{ padding: "0.75rem 2rem", borderRadius: "8px", border: "2px solid #F4A460", backgroundColor: "transparent", color: "#A0522D", fontWeight: "bold", fontSize: "1rem", cursor: "pointer", transition: "all 0.2s" }} onMouseOver={e => (e.currentTarget.style.backgroundColor = "#F5F5DC")} onMouseOut={e => (e.currentTarget.style.backgroundColor = "transparent")}>
              Clear Form
            </button>
            <button type="submit" disabled={loading} style={{ padding: "0.75rem 2rem", borderRadius: "8px", border: "none", backgroundColor: "#E35336", color: "#ffffff", fontWeight: "bold", fontSize: "1.1rem", cursor: "pointer", transition: "all 0.2s", boxShadow: "0 4px 12px rgba(227, 83, 54, 0.3)" }} onMouseOver={e => (e.currentTarget.style.backgroundColor = "#c6452b")} onMouseOut={e => (e.currentTarget.style.backgroundColor = "#E35336")}>
              {loading ? "Submitting..." : "Submit Lead"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
