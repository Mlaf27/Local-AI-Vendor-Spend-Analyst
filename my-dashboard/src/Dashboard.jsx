import React, { useState, useEffect, useMemo, useRef } from "react";
import Papa from "papaparse";
import _ from "lodash";
import { parseISO, getMonth, format } from "date-fns";
import { 
  CheckCircle, Loader2, X, TrendingUp, DollarSign, Cpu, 
  PieChart as PieIcon, BarChart3, FileText, Save, FileDown, AlertTriangle, ArrowUpRight, ArrowDownRight
} from "lucide-react";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, 
  ResponsiveContainer, PieChart, Pie, Cell 
} from "recharts";
import axios from "axios";

// ============================================================
// FINAL DASHBOARD (Polished Overview + Drawer AI)
// ============================================================
export default function Dashboard() {
  // --- STATE ---
  const [loaded, setLoaded] = useState(false);
  const [transactions, setTransactions] = useState([]);
  
  // Navigation
  const [activeTab, setActiveTab] = useState("Overview"); 
  const [selectedVendor, setSelectedVendor] = useState(null);
  
  // Reporting State
  const [actionReport, setActionReport] = useState([]); 
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  // Vendor Chat State (Drawer)
  const [drawerMessages, setDrawerMessages] = useState([]);
  const [drawerInput, setDrawerInput] = useState("");
  const [isDrawerThinking, setIsDrawerThinking] = useState(false);
  const drawerScrollRef = useRef(null);

  // Analysis State
  const [analysisVendorID, setAnalysisVendorID] = useState("");
  const [backendStatus, setBackendStatus] = useState("checking");

  // --- 1. INITIAL LOAD ---
  useEffect(() => {
    checkBackendHealth();
    loadRealData();
  }, []);

  useEffect(() => { drawerScrollRef.current?.scrollIntoView({ behavior: "smooth" }); }, [drawerMessages]);

  useEffect(() => {
    if (selectedVendor) {
        startVendorAnalysis(selectedVendor);
    } else {
        setDrawerMessages([]); 
    }
  }, [selectedVendor]);

  const checkBackendHealth = async () => {
    try {
      await axios.get('http://localhost:3001/api/health');
      setBackendStatus("connected");
    } catch (err) {
      console.error("Backend offline:", err);
      setBackendStatus("error");
    }
  };

  const loadRealData = () => {
    fetch("/vendor_spend_saas.csv")
      .then(r => r.text())
      .then(csvText => {
        Papa.parse(csvText, {
          header: true, skipEmptyLines: true, dynamicTyping: true,
          complete: (results) => {
            setTransactions(results.data);
            setLoaded(true);
            if(results.data.length > 0) setAnalysisVendorID(results.data[0].vendor_name);
          },
          error: (err) => console.error("CSV Error:", err)
        });
      })
      .catch(err => setLoaded(true));
  };

  // --- 2. DATA PROCESSING ---
  const { monthlySpend, categories, topVendors, totalSpend, vendorList, selectedVendorData, kpiStats } = useMemo(() => {
    if (!transactions.length) return { monthlySpend:[], categories:[], topVendors:[], totalSpend:0, vendorList:[], selectedVendorData:[], kpiStats:{} };
    
    const totalSpend = _.sumBy(transactions, "amount");
    const vendorGroups = _.groupBy(transactions, "vendor_name");
    const vendorList = Object.keys(vendorGroups).sort();

    const monthsOrder = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const getMonthlyData = (txs) => {
        const groups = _.groupBy(txs, (t) => {
            const date = parseISO(t.date);
            return isNaN(date) ? "Unknown" : monthsOrder[getMonth(date)];
        });
        return monthsOrder.map(m => ({ month: m, spend: _.sumBy(groups[m] || [], "amount") }));
    };

    const monthlySpend = getMonthlyData(transactions);
    const selectedTxs = transactions.filter(t => t.vendor_name === analysisVendorID);
    const selectedVendorData = getMonthlyData(selectedTxs);

    const catGroups = _.groupBy(transactions, "category");
    const COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899"];
    const categories = Object.keys(catGroups).map((cat, index) => ({
      name: cat, value: _.sumBy(catGroups[cat], "amount"), color: COLORS[index % COLORS.length]
    })).sort((a,b) => b.value - a.value).slice(0, 5);

    const topVendors = Object.keys(vendorGroups).map((v, i) => {
      const txs = vendorGroups[v];
      const annual = _.sumBy(txs, "amount");
      const sortedTxs = _.sortBy(txs, 'date');
      const first = sortedTxs[0]?.amount || 0;
      const last = sortedTxs[sortedTxs.length-1]?.amount || 0;
      const trendVal = first > 0 ? ((last - first)/first)*100 : 0;
      const isReviewed = actionReport.some(r => r.vendor === v);

      return {
        id: i, name: v, annual, category: txs[0].category, dept: txs[0].department,
        trend: Math.abs(trendVal).toFixed(1) + "%", 
        trendDir: trendVal > 0 ? "up" : "down", trendVal,
        flag: isReviewed ? "reviewed" : (trendVal > 15 ? "creep" : null), 
        transactions: txs
      };
    }).sort((a,b) => b.annual - a.annual);

    // KPI STATS
    const alertCount = topVendors.filter(v => v.flag === 'creep').length;
    const topCategory = categories.length > 0 ? categories[0].name : "N/A";
    const avgMonthly = totalSpend / 12;

    return { 
        monthlySpend, categories, topVendors, totalSpend, vendorList, selectedVendorData,
        kpiStats: { alertCount, topCategory, avgMonthly }
    };
  }, [transactions, analysisVendorID, actionReport]);

  // --- 3. DRAWER AI LOGIC ---
  const startVendorAnalysis = async (vendor) => {
    setDrawerMessages([{ role: 'ai', text: `Analyzing spending patterns for ${vendor.name}...` }]);
    setIsDrawerThinking(true);

    const prompt = `Analyze ${vendor.name}. Total spend: $${vendor.annual}. Trend: ${vendor.trendDir} ${vendor.trend}.
    Briefly explain the financial impact.
    CRITICAL: End by asking "What action should we take?"`;

    try {
        const response = await axios.post('http://localhost:3001/api/chat', {
            message: "Analyze this vendor", context: prompt
        });
        setDrawerMessages([{ role: 'ai', text: response.data.response }]);
    } catch (err) {
        setDrawerMessages([{ role: 'ai', text: "Connection Error." }]);
    } finally {
        setIsDrawerThinking(false);
    }
  };

  const handleDrawerChat = async () => {
    if(!drawerInput.trim()) return;
    const userMsg = drawerInput;
    setDrawerMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setDrawerInput("");
    setIsDrawerThinking(true);

    try {
        const response = await axios.post('http://localhost:3001/api/chat', {
            message: userMsg,
            context: `User discussing vendor ${selectedVendor.name}. Context: ${JSON.stringify(drawerMessages)}`
        });
        setDrawerMessages(prev => [...prev, { role: 'ai', text: response.data.response }]);
    } catch (err) {
    } finally {
        setIsDrawerThinking(false);
    }
  };

  // --- 4. AUTO-SUMMARIZE & SAVE ---
  const handleAutoLogDecision = async () => {
    setIsGeneratingReport(true);
    const historyText = drawerMessages.map(m => `${m.role}: ${m.text}`).join("\n");
    const prompt = `Review conversation about ${selectedVendor.name}:\n${historyText}\nTASK: Summarize into: Pain Points, Proposed Solution, Final Decision.`;

    try {
        const response = await axios.post('http://localhost:3001/api/chat', { message: "Generate Report", context: prompt });
        const newEntry = { vendor: selectedVendor.name, summary: response.data.response, date: format(new Date(), "yyyy-MM-dd HH:mm") };
        setActionReport(prev => [...prev, newEntry]);
        setDrawerMessages(prev => [...prev, { role: 'system', text: "✅ Report entry generated and saved." }]);
    } catch (err) {
        alert("Failed to generate summary.");
    } finally {
        setIsGeneratingReport(false);
    }
  };

  // --- 5. EXPORT TO WORD DOC ---
  const handleExportWord = () => {
    if (actionReport.length === 0) return alert("No actions taken yet.");
    const header = "<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>Vendor Report</title></head><body>";
    let bodyContent = "<h1 style='font-size:24px; color:#0F172A;'>Vendor Analysis Report</h1><br/>";
    actionReport.forEach(item => {
        bodyContent += `<div style="border:1px solid #E2E8F0; padding:20px; background-color:#F8FAFC;"><h2 style="color:#2563EB; margin-top:0;">Vendor: ${item.vendor}</h2><p style="color:#64748B; font-size:12px;"><strong>Date:</strong> ${item.date}</p><hr style="border:0; border-top:1px solid #CBD5E1; margin: 15px 0;" /><div style="font-family: Arial, sans-serif; line-height: 1.6;">${item.summary.replace(/\n/g, '<br/>')}</div></div><br/><br/><div style="width:100%; border-bottom: 3px double #000; margin: 20px 0;"></div><br/><br/>`;
    });
    const source = 'data:application/vnd.ms-word;charset=utf-8,' + encodeURIComponent(header + bodyContent + "</body></html>");
    const link = document.createElement("a");
    link.href = source;
    link.download = `Vendor_Decisions_Report_${format(new Date(), "yyyy-MM-dd")}.doc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const fmtK = (n) => n >= 1000 ? `$${(n/1000).toFixed(1)}K` : `$${n}`;

  // --- RENDER ---
  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", background: "#F8FAFC", color: "#0F172A", fontFamily: "sans-serif", overflow: "hidden" }}>
      
      {/* SIDEBAR */}
      <aside style={{ width: 260, background: "#fff", borderRight: "1px solid #E2E8F0", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "24px", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "#2563EB", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800 }}>VS</div>
          <div><div style={{ fontWeight: 700 }}>Vendor Spend</div><div style={{ fontSize: 11, color: "#64748B" }}>LOCAL AI EDITION</div></div>
        </div>
        
        <div style={{ padding: "0 24px 24px" }}>
            <div style={{ padding: "8px 12px", background: backendStatus === "connected" ? "#F0FDF4" : "#FEF2F2", borderRadius: 6, display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600, color: backendStatus === "connected" ? "#166534" : "#991B1B" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: backendStatus === "connected" ? "#22C55E" : "#EF4444" }}></div>
                {backendStatus === "connected" ? "AI System Online" : "Backend Offline"}
            </div>
        </div>

        <nav style={{ padding: "0 12px", display: "flex", flexDirection: "column", gap: 4 }}>
          {["Overview", "Vendors", "Analysis"].map(tab => (
             <div key={tab} onClick={() => setActiveTab(tab)} style={{ display: "flex", gap: 12, padding: "10px 12px", borderRadius: 8, cursor: "pointer", background: activeTab === tab ? "#EFF6FF" : "transparent", color: activeTab === tab ? "#2563EB" : "#64748B", fontWeight: 600 }}>
                {tab === "Overview" && <TrendingUp size={18} />}
                {tab === "Vendors" && <DollarSign size={18} />}
                {tab === "Analysis" && <BarChart3 size={18} />}
                {tab}
             </div>
          ))}
        </nav>
      </aside>

      {/* MAIN CONTENT */}
      <main style={{ flex: 1, overflowY: "auto", padding: 32 }}>
        <header style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
                <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>{activeTab}</h1>
                <p style={{ color: "#64748B" }}>{activeTab === "Analysis" ? "Deep dive into vendor trends" : `${transactions.length} transactions loaded`}</p>
            </div>
            {actionReport.length > 0 && (
                <button onClick={handleExportWord} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", background: "#0F172A", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
                    <FileText size={18} /> Export Report (.doc)
                </button>
            )}
        </header>

        {/* --- VIEW: OVERVIEW --- */}
        {activeTab === "Overview" && (
            <>
                {/* KPI CARDS */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 24, marginBottom: 32 }}>
                    <div style={{ background: "#fff", padding: 20, borderRadius: 12, border: "1px solid #E2E8F0" }}>
                        <div style={{ fontSize: 13, color: "#64748B", fontWeight: 600 }}>TOTAL ANNUAL SPEND</div>
                        <div style={{ fontSize: 28, fontWeight: 700, marginTop: 8, color: "#0F172A" }}>{fmtK(totalSpend)}</div>
                    </div>
                    <div style={{ background: "#fff", padding: 20, borderRadius: 12, border: "1px solid #E2E8F0" }}>
                        <div style={{ fontSize: 13, color: "#64748B", fontWeight: 600 }}>MONTHLY AVERAGE</div>
                        <div style={{ fontSize: 28, fontWeight: 700, marginTop: 8, color: "#0F172A" }}>{fmtK(kpiStats.avgMonthly)}</div>
                    </div>
                    <div style={{ background: "#fff", padding: 20, borderRadius: 12, border: "1px solid #E2E8F0" }}>
                        <div style={{ fontSize: 13, color: "#64748B", fontWeight: 600 }}>TOP CATEGORY</div>
                        <div style={{ fontSize: 20, fontWeight: 700, marginTop: 8, color: "#0F172A", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{kpiStats.topCategory}</div>
                    </div>
                    <div style={{ background: kpiStats.alertCount > 0 ? "#FEF2F2" : "#F0FDF4", padding: 20, borderRadius: 12, border: kpiStats.alertCount > 0 ? "1px solid #FECACA" : "1px solid #BBF7D0" }}>
                        <div style={{ fontSize: 13, color: kpiStats.alertCount > 0 ? "#B91C1C" : "#166534", fontWeight: 600 }}>ACTIVE ALERTS</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                            <div style={{ fontSize: 28, fontWeight: 700, color: kpiStats.alertCount > 0 ? "#991B1B" : "#166534" }}>{kpiStats.alertCount}</div>
                            {kpiStats.alertCount > 0 && <AlertTriangle size={24} color="#EF4444" />}
                        </div>
                    </div>
                </div>

                {/* CHARTS */}
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 24 }}>
                    <div style={{ background: "#fff", padding: 24, borderRadius: 12, border: "1px solid #E2E8F0", height: 400 }}>
                        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 20 }}>Monthly Spend Trend</h3>
                        <ResponsiveContainer width="100%" height="90%">
                            <BarChart data={monthlySpend}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fontSize:12, fill:"#94A3B8"}} dy={10} />
                                <YAxis axisLine={false} tickLine={false} tick={{fontSize:12, fill:"#94A3B8"}} tickFormatter={fmtK} />
                                <RechartsTooltip cursor={{fill: '#F8FAFC'}} formatter={(value) => fmtK(value)} contentStyle={{borderRadius: 8, border:"none", boxShadow:"0 4px 12px rgba(0,0,0,0.1)"}} />
                                <Bar dataKey="spend" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    <div style={{ background: "#fff", padding: 24, borderRadius: 12, border: "1px solid #E2E8F0", height: 400 }}>
                        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 20 }}>Spend by Category</h3>
                        <ResponsiveContainer width="100%" height="90%">
                            <PieChart>
                                <Pie data={categories} innerRadius={80} outerRadius={110} paddingAngle={2} dataKey="value">
                                    {categories.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} strokeWidth={0} />)}
                                </Pie>
                                <RechartsTooltip formatter={(value) => fmtK(value)} contentStyle={{borderRadius: 8}} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </>
        )}

        {/* --- VIEW: VENDORS --- */}
        {activeTab === "Vendors" && (
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead style={{ background: "#F8FAFC" }}>
                        <tr>{["Vendor", "Category", "Trend", "Status", "Action"].map(h => <th key={h} style={{ textAlign: "left", padding: "12px 24px", fontSize: 12, color: "#64748B" }}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                        {topVendors.map(v => (
                            <tr key={v.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                                <td style={{ padding: "16px 24px", fontWeight: 600 }}>{v.name}</td>
                                <td style={{ padding: "16px 24px", color: "#64748B" }}>{v.category}</td>
                                <td style={{ padding: "16px 24px", display: "flex", alignItems: "center", gap: 4, color: v.trendDir === 'up' ? "#EF4444" : "#10B981", fontWeight: 500 }}>
                                    {v.trendDir === 'up' ? <ArrowUpRight size={16}/> : <ArrowDownRight size={16}/>}{v.trend}
                                </td>
                                <td style={{ padding: "16px 24px" }}>
                                    {v.flag === 'creep' && <span style={{ background: "#FEF2F2", color: "#DC2626", padding: "4px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700 }}>RISK</span>}
                                    {v.flag === 'reviewed' && <span style={{ background: "#F0FDF4", color: "#166534", padding: "4px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700 }}>REVIEWED</span>}
                                </td>
                                <td style={{ padding: "16px 24px" }}>
                                    <button onClick={() => setSelectedVendor(v)} style={{ padding: "8px 16px", background: "#fff", border: "1px solid #E2E8F0", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 500 }}>Take Action</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )}

        {/* --- VIEW: ANALYSIS --- */}
        {activeTab === "Analysis" && (
            <div style={{ background: "#fff", padding: 24, borderRadius: 12, border: "1px solid #E2E8F0", height: "calc(100vh - 140px)", display: "flex", flexDirection: "column" }}>
                <div style={{ marginBottom: 24, display: "flex", alignItems: "center", gap: 12 }}>
                    <label style={{ fontWeight: 600, fontSize: 14 }}>Select Vendor:</label>
                    <select value={analysisVendorID} onChange={(e) => setAnalysisVendorID(e.target.value)} style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: 14 }}>
                        {vendorList.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                </div>
                <div style={{ flex: 1 }}>
                     <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>{analysisVendorID} Monthly Spend</h3>
                     <ResponsiveContainer width="100%" height="90%">
                        <BarChart data={selectedVendorData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fontSize:12, fill:"#94A3B8"}} />
                            <YAxis axisLine={false} tickLine={false} tick={{fontSize:12, fill:"#94A3B8"}} tickFormatter={fmtK} />
                            <RechartsTooltip formatter={(value) => fmtK(value)} />
                            <Bar dataKey="spend" fill="#8B5CF6" radius={[4, 4, 0, 0]} barSize={50} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
        )}

      </main>

      {/* DRAWER (FIXED) */}
      {selectedVendor && (
        <>
            <div onClick={() => setSelectedVendor(null)} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.3)", zIndex: 40, backdropFilter: "blur(2px)" }} />
            <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 500, background: "#fff", boxShadow: "-10px 0 30px rgba(0,0,0,0.1)", zIndex: 50, display: "flex", flexDirection: "column" }}>
                <div style={{ padding: "24px", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div><h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{selectedVendor.name}</h2><div style={{ fontSize: 13, color: "#64748B", marginTop: 4 }}>{selectedVendor.category} • {fmtK(selectedVendor.annual)}/yr</div></div>
                    <button onClick={() => setSelectedVendor(null)} style={{ border: "none", background: "none", cursor: "pointer", padding: 8, color: "black" }}><X size={24} /></button>
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 16, background: "#F8FAFC" }}>
                    {drawerMessages.map((msg, i) => (
                        <div key={i} style={{ alignSelf: msg.role === 'user' ? "flex-end" : "flex-start", maxWidth: "90%" }}>
                            <div style={{ padding: "12px 16px", borderRadius: 12, fontSize: 14, lineHeight: 1.5, background: msg.role === 'user' ? "#0F172A" : "#fff", color: msg.role === 'user' ? "#fff" : "#334155", border: msg.role === 'user' ? "none" : "1px solid #E2E8F0", borderBottomRightRadius: msg.role === 'user' ? 2 : 12, borderBottomLeftRadius: msg.role === 'ai' ? 2 : 12, boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}>{msg.text}</div>
                        </div>
                    ))}
                    {isDrawerThinking && <div style={{ alignSelf: "flex-start", color: "#64748B", fontSize: 12, marginLeft: 8 }}>AI is analyzing...</div>}
                    <div ref={drawerScrollRef} />
                </div>
                <div style={{ padding: 20, borderTop: "1px solid #E2E8F0", background: "#fff" }}>
                    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                        <input value={drawerInput} onChange={(e) => setDrawerInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleDrawerChat()} placeholder="Discuss options with AI..." style={{ flex: 1, padding: "12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 14, outline: "none" }} />
                        <button onClick={handleDrawerChat} style={{ padding: "0 12px", background: "#F1F5F9", color: "#475569", border: "none", borderRadius: 8, cursor: "pointer" }}><Cpu size={18} /></button>
                    </div>
                    <button onClick={handleAutoLogDecision} disabled={isGeneratingReport} style={{ width: "100%", padding: "12px", background: "#16A34A", color: "#fff", border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer", display: "flex", justifyContent: "center", alignItems: "center", gap: 8 }}>
                        {isGeneratingReport ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                        {isGeneratingReport ? "Summarizing..." : "Auto-Summarize & Save to Report"}
                    </button>
                </div>
            </div>
        </>
      )}
      <style>{`.animate-spin { animation: spin 1s linear infinite; } @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}