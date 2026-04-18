import React, { useState, useEffect } from 'react';
import {
  ArrowRight, Paperclip, ShieldAlert, AlertCircle,
  RefreshCw, Sun, Moon, CheckCircle2, Shield, Check,
  ShieldCheck, Info, History, LogOut, LogIn, UserCircle
} from 'lucide-react';
import { auth, googleProvider, signInWithPopup, signOut, db } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';

// ─── Severity helpers ──────────────────────────────────────────────────────────
const severityConfig = {
  high: {
    iconBg:    'bg-red-50 dark:bg-red-500/10',
    iconBorder:'border-red-100 dark:border-red-500/20',
    icon:      <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />,
    badgeBg:   'bg-red-50 dark:bg-red-500/10',
    badgeText: 'text-red-600 dark:text-red-400',
    badge:     'Failed',
    shimmer:   'from-red-500/0 via-red-500/[0.02] to-red-500/0',
  },
  medium: {
    iconBg:    'bg-orange-50 dark:bg-orange-500/10',
    iconBorder:'border-orange-100 dark:border-orange-500/20',
    icon:      <ShieldAlert className="w-5 h-5 text-orange-600 dark:text-orange-400" />,
    badgeBg:   'bg-orange-50 dark:bg-orange-500/10',
    badgeText: 'text-orange-600 dark:text-orange-400',
    badge:     'Warning',
    shimmer:   'from-orange-500/0 via-orange-500/[0.02] to-orange-500/0',
  },
  low: {
    iconBg:    'bg-yellow-50 dark:bg-yellow-500/10',
    iconBorder:'border-yellow-100 dark:border-yellow-500/20',
    icon:      <Info className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />,
    badgeBg:   'bg-yellow-50 dark:bg-yellow-500/10',
    badgeText: 'text-yellow-600 dark:text-yellow-400',
    badge:     'Advisory',
    shimmer:   'from-yellow-500/0 via-yellow-500/[0.02] to-yellow-500/0',
  },
};

function getSeverity(issue) {
  const s = (issue.severity || 'medium').toLowerCase();
  return severityConfig[s] || severityConfig.medium;
}

// ─── Verdict config ────────────────────────────────────────────────────────────
const verdictConfig = {
  'High Risk': {
    badge:      'CRITICAL THREAT',
    badgeCls:   'bg-red-50 dark:bg-red-500/10 border-red-100 dark:border-red-500/20 text-red-600 dark:text-red-400',
    badgeIcon:  <ShieldAlert className="w-3.5 h-3.5" />,
    strokeColor:'#ef4444',
    headline:   'Do not proceed.\nHighly suspicious.',
    subtext:    'Our semantic AI detected severe anomalies consistent with advance-fee scams and identity theft.',
  },
  'Suspicious': {
    badge:      'SUSPICIOUS OFFER',
    badgeCls:   'bg-orange-50 dark:bg-orange-500/10 border-orange-100 dark:border-orange-500/20 text-orange-600 dark:text-orange-400',
    badgeIcon:  <ShieldAlert className="w-3.5 h-3.5" />,
    strokeColor:'#f97316',
    headline:   'Proceed with caution.\nNeeds verification.',
    subtext:    'Several patterns indicate this offer may not be legitimate. Verify through official channels before engaging.',
  },
  'Safe': {
    badge:      'LOOKS LEGITIMATE',
    badgeCls:   'bg-green-50 dark:bg-green-500/10 border-green-100 dark:border-green-500/20 text-green-600 dark:text-green-400',
    badgeIcon:  <ShieldCheck className="w-3.5 h-3.5" />,
    strokeColor:'#22c55e',
    headline:   'Low risk detected.\nLooks authentic.',
    subtext:    'No major fraud indicators found. Always verify through the official company website before sharing personal data.',
  },
};

// ─── Animated score counter ────────────────────────────────────────────────────
function useAnimatedNumber(target, duration = 1600) {
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    let startTime = null;
    const from = 0;
    const step = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setCurrent(Math.round(from + (target - from) * eased));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration]);
  return current;
}

// ─── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [appState,    setAppState]    = useState('idle');   // idle | analyzing | result | error
  const [loadingText, setLoadingText] = useState('Initializing scan...');
  const [scanProgress,setScanProgress]= useState(0);
  const [isDark,      setIsDark]      = useState(true);
  const [mousePos,    setMousePos]    = useState({ x: 0, y: 0 });
  const [formData,    setFormData]    = useState({ companyName: '', senderEmail: '', offerContent: '' });
  const [fileName,    setFileName]    = useState('');
  const [fileObj,     setFileObj]     = useState(null);
  const [result,      setResult]      = useState(null);    // API response
  const [errorMsg,    setErrorMsg]    = useState('');
  
  // Custom auth & history state
  const [user,        setUser]        = useState(null);
  const [view,        setView]        = useState('scan'); // 'scan' | 'history' | 'auth'
  const [history,     setHistory]     = useState([]);
  const [loadingHist, setLoadingHist] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  const loginWithGoogle = async () => {
    try { 
      await signInWithPopup(auth, googleProvider);
      setView('scan'); // Go back to homepage after login
    } catch (e) {
      console.error('Sign in error', e);
    }
  };
  const logoutUser = async () => {
    await signOut(auth);
    setView('scan');
  };

  const fetchHistory = async () => {
    if (!user) return;
    setLoadingHist(true);
    try {
      const q = query(collection(db, 'scans'), where('userId', '==', user.uid));
      const snap = await getDocs(q);
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Sort in JS to avoid needing a Firestore Composite Index
      docs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setHistory(docs);
    } catch (e) {
      console.error('Failed to fetch history:', e);
    } finally {
      setLoadingHist(false);
    }
  };

  const loadHistoryResult = (scanData) => {
    setResult(scanData);
    setAppState('result');
    setView('scan');
  };

  useEffect(() => {
    if (view === 'history' && user) fetchHistory();
  }, [view, user]);

  const animatedScore = useAnimatedNumber(result?.riskScore ?? 0, 1800);

  // Cursor spotlight
  useEffect(() => {
    const handle = (e) => requestAnimationFrame(() => setMousePos({ x: e.clientX, y: e.clientY }));
    window.addEventListener('mousemove', handle);
    return () => window.removeEventListener('mousemove', handle);
  }, []);

  // Theme init
  useEffect(() => {
    const saved     = localStorage.getItem('internshield-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setIsDark(saved === 'dark' || (!saved && prefersDark));
  }, []);

  const toggleTheme = () => {
    setIsDark(prev => {
      localStorage.setItem('internshield-theme', !prev ? 'dark' : 'light');
      return !prev;
    });
  };

  // Subtle click sound
  const playClickSound = () => {
    try {
      const Ctx  = window.AudioContext || window.webkitAudioContext;
      const ctx  = new Ctx();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      osc.start(); osc.stop(ctx.currentTime + 0.1);
    } catch {}
  };

  // ── Scan animation driver ──────────────────────────────────────────────────
  const runScanAnimation = () => {
    const scanPhrases = [
      'Establishing secure connection...',
      'Scanning domain integrity...',
      'Analyzing semantic patterns...',
      'Detecting financial anomalies...',
      'Cross-referencing fraud database...',
      'Generating final risk score...',
    ];
    let step = 0;
    setScanProgress(0);
    setLoadingText(scanPhrases[0]);

    const phraseInterval = setInterval(() => {
      step++;
      if (step < scanPhrases.length) setLoadingText(scanPhrases[step]);
    }, 800);

    const progressInterval = setInterval(() => {
      setScanProgress(prev => {
        if (prev >= 95) { clearInterval(progressInterval); return 95; }
        return prev + 1;
      });
    }, 45);

    return { phraseInterval, progressInterval };
  };

  // ── Form submit → real API call ────────────────────────────────────────────
  const handleAnalyze = async (e) => {
    e.preventDefault();
    playClickSound();
    setAppState('analyzing');
    setErrorMsg('');

    const { phraseInterval, progressInterval } = runScanAnimation();

    try {
      const body = new FormData();
      body.append('companyName',  formData.companyName);
      body.append('senderEmail',  formData.senderEmail);
      body.append('offerContent', formData.offerContent);
      if (fileObj) body.append('file', fileObj);
      if (user)    body.append('userId', user.uid);

      const res = await fetch('/.netlify/functions/analyze', {
        method: 'POST',
        body,
      });

      const data = await res.json();

      clearInterval(phraseInterval);
      clearInterval(progressInterval);
      setScanProgress(100);

      if (!res.ok) throw new Error(data.error || 'Analysis failed');

      setTimeout(() => {
        setResult(data);
        setAppState('result');
      }, 400);

    } catch (err) {
      clearInterval(phraseInterval);
      clearInterval(progressInterval);
      setErrorMsg(err.message || 'Something went wrong. Please try again.');
      setAppState('error');
    }
  };

  const resetApp = () => {
    setAppState('idle');
    setFormData({ companyName: '', senderEmail: '', offerContent: '' });
    setFileName('');
    setFileObj(null);
    setResult(null);
    setErrorMsg('');
    setScanProgress(0);
  };

  // ── Verdict display helpers ────────────────────────────────────────────────
  const vc = verdictConfig[result?.verdict] || verdictConfig['Suspicious'];

  return (
    <div className={isDark ? 'dark' : ''}>
      <div className="relative min-h-screen bg-[#FAFAFA] dark:bg-[#000000] text-zinc-900 dark:text-zinc-100 font-sans selection:bg-zinc-200 dark:selection:bg-zinc-800 selection:text-black dark:selection:text-white flex flex-col overflow-hidden transition-colors duration-500 will-change-transform">

        {/* CURSOR SPOTLIGHT */}
        <div
          className="pointer-events-none fixed inset-0 z-50 transition-opacity duration-300"
          style={{
            background: isDark
              ? `radial-gradient(600px circle at ${mousePos.x}px ${mousePos.y}px, rgba(255,255,255,0.04), transparent 40%)`
              : `radial-gradient(600px circle at ${mousePos.x}px ${mousePos.y}px, rgba(0,0,0,0.05), transparent 40%)`,
          }}
        />

        {/* BACKGROUND LAYERS */}
        <div className="absolute inset-0 z-0 pointer-events-none opacity-[0.03] mix-blend-overlay" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E")' }} />
        <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[70vw] h-[60vh] blur-[140px] rounded-full pointer-events-none z-0 transition-colors duration-1000 bg-black/[0.02] dark:bg-white/[0.03]" />
        <div className="absolute inset-0 z-0 pointer-events-none transition-all duration-1000 opacity-[0.04] dark:opacity-[0.12]" style={{ backgroundImage: `radial-gradient(${isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.8)'} 1px, transparent 1px)`, backgroundSize: '32px 32px' }} />

        {/* ── HEADER ─────────────────────────────────────────────────────── */}
        <header className="relative w-full px-6 py-8 md:px-12 flex justify-between items-center z-20 reveal-epic">
          <div
            className="font-bold tracking-tight text-zinc-900 dark:text-zinc-100 cursor-pointer flex items-center gap-3 hover:opacity-80 transition-opacity duration-500"
            onClick={resetApp}
          >
            <div className="relative flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-tr from-zinc-900 to-zinc-700 dark:from-zinc-100 dark:to-zinc-300 shadow-lg overflow-hidden group">
              <div className="absolute inset-0 bg-white/20 dark:bg-black/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
              <Shield className="w-4 h-4 text-white dark:text-black relative z-10" />
              <div className="absolute top-1 right-1 w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(74,222,128,0.8)]" />
            </div>
            <span className="text-xl bg-clip-text text-transparent bg-gradient-to-r from-zinc-900 to-zinc-600 dark:from-white dark:to-zinc-400">
              InternShield.
            </span>
          </div>

          <div className="flex items-center gap-4">
            {user && (
              <button 
                onClick={() => setView(view === 'history' ? 'scan' : 'history')} 
                className="flex items-center gap-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors bg-black/[0.04] dark:bg-white/[0.05] px-4 py-2 rounded-full"
              >
                {view === 'history' ? <ShieldCheck className="w-4 h-4" /> : <History className="w-4 h-4" />}
                {view === 'history' ? 'New Scan' : 'History'}
              </button>
            )}

            {user ? (
              <div className="flex items-center gap-3">
                <img src={user.photoURL} alt="Profile" className="w-9 h-9 rounded-full border border-black/10 dark:border-white/10" />
                <button onClick={logoutUser} className="hidden sm:flex items-center gap-2 flex items-center justify-center p-2.5 rounded-full bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20 transition-colors">
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button onClick={() => setView('auth')} className="flex items-center gap-2 text-sm font-semibold bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black px-5 py-2.5 rounded-full hover:scale-105 transition-transform active:scale-95 shadow-lg shadow-black/10 dark:shadow-white/5">
                <UserCircle className="w-4 h-4" /> Sign In
              </button>
            )}

            <button
              onClick={toggleTheme}
              className="p-2.5 rounded-full bg-black/[0.03] dark:bg-white/[0.05] text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-black/[0.05] dark:hover:bg-white/[0.1] hover:scale-105 transition-all duration-500 active:scale-95"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {/* ── MAIN ───────────────────────────────────────────────────────── */}
        <main className="relative z-10 flex-1 w-full max-w-6xl mx-auto px-6 py-12 flex flex-col justify-center">

          {/* ════════════════════════════════════════════════════════════════
              VIEW: AUTH (LOGIN PAGE)
          ════════════════════════════════════════════════════════════════ */}
          {view === 'auth' && !user && (
            <div className="w-full max-w-md mx-auto my-20 reveal-epic">
              <div className="p-8 md:p-12 rounded-3xl bg-white dark:bg-[#0A0A0A] border border-zinc-200 dark:border-zinc-800 shadow-2xl relative overflow-hidden text-center">
                {/* Background glow */}
                <div className="absolute -top-24 -right-24 w-48 h-48 bg-green-500/10 blur-[60px] rounded-full pointer-events-none" />
                
                <div className="w-16 h-16 mx-auto bg-black/[0.04] dark:bg-white/[0.05] rounded-2xl flex items-center justify-center mb-6">
                  <ShieldCheck className="w-8 h-8 text-zinc-900 dark:text-zinc-100" />
                </div>
                
                <h2 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100 mb-3 tracking-tight">Welcome Back</h2>
                <p className="text-zinc-500 dark:text-zinc-400 mb-8 leading-relaxed">
                  Sign in to save your fraud scans securely in the cloud and access your personal history globally.
                </p>

                <button
                  onClick={loginWithGoogle}
                  className="w-full flex items-center justify-center gap-3 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black font-semibold py-4 px-6 rounded-full hover:scale-[1.02] transition-transform active:scale-95 shadow-xl shadow-black/10 dark:shadow-white/5 group"
                >
                  <svg className="w-5 h-5 bg-white rounded-full p-0.5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  Continue with Google
                  <ArrowRight className="w-4 h-4 opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-0 transition-all duration-300" />
                </button>
                
                <p className="mt-6 text-xs text-zinc-400 dark:text-zinc-500">
                  By signing in, you agree to our Terms of Service and Anti-Fraud policies.
                </p>
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════════
              VIEW: HISTORY
          ════════════════════════════════════════════════════════════════ */}
          {view === 'history' && (
            <div className="w-full max-w-4xl mx-auto space-y-6">
              <div className="mb-8 flex items-center justify-between">
                <div>
                  <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-zinc-900 to-zinc-500 dark:from-zinc-100 dark:to-zinc-500">Scan History</h2>
                  <p className="text-zinc-500 dark:text-zinc-400 mt-2">Your past internship fraud checks.</p>
                </div>
                <button onClick={fetchHistory} className="p-2.5 bg-black/[0.05] dark:bg-white/[0.05] rounded-full hover:scale-110 transition-transform">
                  <RefreshCw className={`w-5 h-5 ${loadingHist ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {loadingHist ? (
                <div className="py-20 flex justify-center items-center text-zinc-400"><RefreshCw className="w-8 h-8 animate-spin" /></div>
              ) : history.length === 0 ? (
                <div className="py-20 text-center border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-3xl">
                  <ShieldAlert className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-700 mb-4" />
                  <p className="text-lg text-zinc-500">No scans found.</p>
                </div>
              ) : (
                <div className="grid gap-4">
                  {history.map((scan) => {
                    const isDanger = scan.riskScore >= 75;
                    const isWarn = scan.riskScore >= 35 && scan.riskScore < 75;
                    return (
                      <div 
                        key={scan.id} 
                        onClick={() => loadHistoryResult(scan)}
                        className="relative p-5 rounded-2xl bg-white dark:bg-[#0A0A0A] border border-zinc-200 dark:border-zinc-800 flex flex-col gap-4 cursor-pointer hover:border-zinc-400 dark:hover:border-zinc-500 hover:shadow-lg transition-all duration-300 group"
                      >
                        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                          <div className="flex items-start gap-4">
                            <div className={`w-14 h-14 shrink-0 rounded-full flex items-center justify-center font-bold text-lg
                              ${isDanger ? 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400' : 
                                isWarn ? 'bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400' : 
                                  'bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400'}
                            `}>
                              {scan.riskScore}%
                            </div>
                            <div className="space-y-1">
                              <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 text-lg leading-none group-hover:text-blue-500 transition-colors">
                                {scan.companyName}
                              </h3>
                              <p className="text-sm text-zinc-500 dark:text-zinc-400">{scan.senderEmail} • {new Date(scan.createdAt).toLocaleDateString()}</p>
                            </div>
                          </div>
                          
                          <div className={`text-sm font-semibold px-4 py-1.5 rounded-full border self-start md:self-auto
                            ${isDanger ? 'bg-red-50 border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/20 dark:text-red-400' : 
                              isWarn ? 'bg-orange-50 border-orange-200 text-orange-600 dark:bg-orange-500/10 dark:border-orange-500/20 dark:text-orange-400' : 
                                'bg-green-50 border-green-200 text-green-600 dark:bg-green-500/10 dark:border-green-500/20 dark:text-green-400'}
                          `}>
                            {scan.verdict}
                          </div>
                        </div>

                        {/* Short AI Analysis Summary */}
                        {scan.summary && (
                          <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-white/[0.02] p-4 rounded-xl border border-zinc-100 dark:border-zinc-800/50 leading-relaxed line-clamp-2 md:line-clamp-3">
                            <span className="font-semibold text-zinc-900 dark:text-zinc-300 mr-2">Analysis:</span> 
                            {scan.summary}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════════
              VIEW 1 — IDLE / FORM
          ════════════════════════════════════════════════════════════════ */}
          {appState === 'idle' && view === 'scan' && (
            <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-20 w-full">

              <div className="w-full lg:w-1/2 flex flex-col justify-center">
                <div className="mb-10 reveal-epic relative">
                  <h1 className="relative text-5xl lg:text-6xl font-semibold tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-zinc-900 to-zinc-600 dark:from-zinc-50 dark:to-zinc-400 mb-6 leading-[1.1]">
                    This internship <br className="hidden md:block" /> could be fake.
                  </h1>
                  <p className="relative text-lg text-zinc-500 dark:text-zinc-400 leading-relaxed font-light">
                    Our AI model detects fraud patterns, financial anomalies, and domain mismatches before you share personal data.
                  </p>
                </div>

                <form onSubmit={handleAnalyze} className="space-y-6 reveal-epic delay-100 relative">
                  <div className="p-[1px] rounded-2xl bg-gradient-to-b from-black/[0.06] dark:from-white/[0.1] to-transparent shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_32px_-12px_rgba(0,0,0,0.5)] transition-all duration-700">
                    <div className="bg-white/80 dark:bg-[#0A0A0A]/90 backdrop-blur-xl rounded-xl p-1 shadow-sm dark:shadow-none">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-zinc-200 dark:bg-white/[0.05]">

                        {/* Company Name */}
                        <div className="bg-white dark:bg-[#0A0A0A] p-5 md:rounded-tl-xl focus-within:bg-zinc-50 dark:focus-within:bg-[#0F0F0F] transition-all duration-500 group relative overflow-hidden">
                          <label className="block text-xs font-semibold tracking-wide text-zinc-400 dark:text-zinc-500 mb-2 uppercase">Company Name</label>
                          <input
                            id="company-name"
                            type="text"
                            value={formData.companyName}
                            onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                            required
                            placeholder="e.g. Acme Corp"
                            className="w-full bg-transparent text-base font-medium focus:outline-none text-zinc-900 dark:text-zinc-100 placeholder-zinc-300 dark:placeholder-zinc-700 relative z-10"
                          />
                          <div className="absolute bottom-0 left-0 h-[1px] w-full bg-transparent group-focus-within:bg-gradient-to-r from-transparent via-zinc-400 dark:via-zinc-500 to-transparent transition-all duration-500 z-0" />
                        </div>

                        {/* Sender Email */}
                        <div className="bg-white dark:bg-[#0A0A0A] p-5 md:rounded-tr-xl focus-within:bg-zinc-50 dark:focus-within:bg-[#0F0F0F] transition-all duration-500 group relative overflow-hidden">
                          <label className="block text-xs font-semibold tracking-wide text-zinc-400 dark:text-zinc-500 mb-2 uppercase">Sender Email</label>
                          <input
                            id="sender-email"
                            type="email"
                            value={formData.senderEmail}
                            onChange={(e) => setFormData({ ...formData, senderEmail: e.target.value })}
                            required
                            placeholder="hr@acme-careers.com"
                            className="w-full bg-transparent text-base font-medium focus:outline-none text-zinc-900 dark:text-zinc-100 placeholder-zinc-300 dark:placeholder-zinc-700 relative z-10"
                          />
                          <div className="absolute bottom-0 left-0 h-[1px] w-full bg-transparent group-focus-within:bg-gradient-to-r from-transparent via-zinc-400 dark:via-zinc-500 to-transparent transition-all duration-500 z-0" />
                        </div>
                      </div>

                      {/* Offer Content */}
                      <div className="bg-white dark:bg-[#0A0A0A] p-5 mt-px rounded-b-xl focus-within:bg-zinc-50 dark:focus-within:bg-[#0F0F0F] transition-all duration-500 group relative overflow-hidden">
                        <label className="block text-xs font-semibold tracking-wide text-zinc-400 dark:text-zinc-500 mb-2 uppercase">Offer Content</label>
                        <textarea
                          id="offer-content"
                          required
                          value={formData.offerContent}
                          onChange={(e) => setFormData({ ...formData, offerContent: e.target.value })}
                          rows="3"
                          placeholder="Paste the email body or offer letter text here..."
                          className="w-full bg-transparent text-base focus:outline-none text-zinc-900 dark:text-zinc-100 placeholder-zinc-300 dark:placeholder-zinc-700 resize-none leading-relaxed relative z-10"
                        />
                        <div className="absolute bottom-0 left-0 h-[1px] w-full bg-transparent group-focus-within:bg-gradient-to-r from-transparent via-zinc-400 dark:via-zinc-500 to-transparent transition-all duration-500 z-0" />
                      </div>
                    </div>
                  </div>

                  {/* File + Submit row */}
                  <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-6 reveal-epic delay-200">
                    <label className="w-full sm:w-auto flex items-center justify-center gap-3 text-sm font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer transition-colors duration-500 group">
                      <div className="p-2.5 rounded-full bg-black/[0.03] dark:bg-white/[0.03] group-hover:bg-black/[0.08] dark:group-hover:bg-white/[0.08] transition-colors duration-500 group-hover:scale-105">
                        {fileName
                          ? <Check className="w-4 h-4 text-green-500" />
                          : <Paperclip className="w-4 h-4 text-zinc-400 dark:text-zinc-300 group-hover:text-zinc-700 dark:group-hover:text-zinc-100 transition-colors duration-500" />
                        }
                      </div>
                      <span className="truncate max-w-[150px]">{fileName || 'Attach PDF / DOCX'}</span>
                      <input
                        id="file-upload"
                        type="file"
                        className="hidden"
                        accept=".pdf,.doc,.docx"
                        onChange={(e) => {
                          const f = e.target.files[0];
                          setFileName(f?.name || '');
                          setFileObj(f || null);
                        }}
                      />
                    </label>

                    <button
                      id="analyze-btn"
                      type="submit"
                      className="relative group w-full sm:w-auto px-8 py-3.5 rounded-full font-medium text-sm overflow-hidden transition-all duration-300 active:scale-[0.97]"
                    >
                      <div className="absolute inset-0 bg-zinc-900 dark:bg-zinc-100 transition-all duration-300" />
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-r from-transparent via-white/20 dark:via-black/10 to-transparent blur-md" />
                      <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/30 dark:via-black/20 to-transparent" />
                      <span className="relative z-10 flex items-center justify-center gap-2 text-white dark:text-black">
                        Analyze Document
                        <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                      </span>
                    </button>
                  </div>
                </form>
              </div>

              {/* Premium CSS Orb */}
              <div className="hidden lg:flex w-1/2 h-[500px] reveal-epic delay-300 relative pointer-events-none items-center justify-center">
                <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-black/5 dark:via-white/5 to-transparent rounded-full blur-3xl opacity-50" />
                <div className="relative w-64 h-64 animate-[float-orb_6s_ease-in-out_infinite]">
                  <div className="absolute inset-0 bg-gradient-to-tr from-zinc-300 to-zinc-500 dark:from-zinc-600 dark:to-zinc-800 rounded-full blur-2xl opacity-60 animate-[spin-slow_15s_linear_infinite]" />
                  <div className="absolute inset-0 bg-gradient-to-br from-white via-zinc-200 to-zinc-400 dark:from-zinc-200 dark:via-zinc-500 dark:to-zinc-900 animate-[morph-orb_8s_ease-in-out_infinite] shadow-[inset_0_-10px_40px_rgba(0,0,0,0.15)] dark:shadow-[inset_0_-20px_50px_rgba(0,0,0,0.6)] flex items-center justify-center overflow-hidden border border-white/20 dark:border-white/10">
                    <div className="w-[150%] h-[150%] bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.6),transparent_50%)] dark:bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.2),transparent_50%)] animate-[spin-slow_10s_linear_infinite_reverse]" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════════
              VIEW 2 — ANALYZING (cinematic)
          ════════════════════════════════════════════════════════════════ */}
          {appState === 'analyzing' && (
            <div className="fixed inset-0 z-50 bg-[#050505] flex flex-col items-center justify-center overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-white/40 to-transparent animate-scan-full" />

              <div className="relative flex flex-col items-center gap-12">
                <div className="relative w-32 h-32 flex items-center justify-center">
                  <div className="absolute inset-0 rounded-full border border-white/10 animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite]" />
                  <div className="absolute inset-2 rounded-full border border-white/20 animate-[spin_4s_linear_infinite] border-t-transparent" />
                  <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-[0_0_40px_rgba(255,255,255,0.3)]">
                    <span className="text-black font-mono font-bold text-lg">{scanProgress}%</span>
                  </div>
                </div>

                <div className="flex flex-col items-center gap-3">
                  <div className="text-sm text-white/70 font-mono tracking-widest uppercase animate-pulse text-center px-4">
                    {loadingText}
                  </div>
                  <div className="flex gap-1">
                    <div className="w-1 h-1 bg-white/50 rounded-full animate-bounce" />
                    <div className="w-1 h-1 bg-white/50 rounded-full animate-bounce delay-100" />
                    <div className="w-1 h-1 bg-white/50 rounded-full animate-bounce delay-200" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════════
              VIEW 3 — ERROR
          ════════════════════════════════════════════════════════════════ */}
          {appState === 'error' && (
            <div className="flex flex-col items-center gap-6 py-20 animate-[fadeInUp_0.6s_cubic-bezier(0.16,1,0.3,1)]">
              <div className="w-16 h-16 rounded-full bg-red-50 dark:bg-red-500/10 flex items-center justify-center border border-red-100 dark:border-red-500/20">
                <AlertCircle className="w-8 h-8 text-red-500" />
              </div>
              <div className="text-center max-w-md">
                <h2 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Analysis Failed</h2>
                <p className="text-zinc-500 dark:text-zinc-400 font-light">{errorMsg}</p>
              </div>
              <button
                onClick={resetApp}
                className="flex items-center gap-2 px-6 py-3.5 rounded-full text-sm font-medium text-zinc-600 dark:text-zinc-300 bg-white dark:bg-white/[0.03] hover:bg-zinc-100 dark:hover:bg-white/[0.08] hover:text-zinc-900 dark:hover:text-white transition-all duration-500 border border-zinc-200 dark:border-white/[0.05] shadow-sm active:scale-95 group"
              >
                <RefreshCw className="w-4 h-4 group-hover:-rotate-180 transition-transform duration-700" />
                Try again
              </button>
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════════
              VIEW 4 — RESULT
          ════════════════════════════════════════════════════════════════ */}
          {appState === 'result' && result && (
            <div className="relative w-full max-w-5xl mx-auto animate-[fadeInUp_0.6s_cubic-bezier(0.16,1,0.3,1)]">

              {/* Background watermark score */}
              <div className="absolute top-1/2 left-[70%] -translate-x-1/2 -translate-y-[55%] text-[18rem] md:text-[22rem] font-bold tracking-tighter text-black/[0.02] dark:text-white/[0.015] pointer-events-none select-none z-0 animate-score-pulse">
                {result.riskScore}
              </div>

              <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-start">

                {/* ── LEFT: Verdict & Score ───────────────────────────── */}
                <div className="lg:col-span-5 flex flex-col items-center md:items-start text-center md:text-left reveal-epic">
                  {/* Badge */}
                  <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold tracking-wide mb-8 backdrop-blur-md ${vc.badgeCls}`}>
                    {vc.badgeIcon}
                    {vc.badge}
                  </div>

                  {/* Score gauge */}
                  <div className="relative mb-8 group">
                    <svg viewBox="0 0 100 100" className="w-48 h-48 drop-shadow-[0_0_20px_rgba(239,68,68,0.15)] dark:drop-shadow-[0_0_30px_rgba(239,68,68,0.15)] group-hover:scale-[1.02] transition-transform duration-700">
                      <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-200 dark:text-zinc-800/60" />
                      <circle
                        cx="50" cy="50" r="46"
                        fill="none"
                        stroke={vc.strokeColor}
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeDasharray="289"
                        strokeDashoffset={289 - (289 * animatedScore) / 100}
                        className="transition-all duration-[2000ms] ease-out delay-300"
                        transform="rotate(-90 50 50)"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-5xl font-semibold tracking-tighter text-zinc-900 dark:text-zinc-100 bg-clip-text text-transparent bg-gradient-to-br from-zinc-900 to-zinc-600 dark:from-white dark:to-zinc-400">
                        {animatedScore}<span className="text-2xl text-zinc-500">%</span>
                      </span>
                      <span className="text-[10px] font-semibold tracking-widest text-zinc-400 uppercase mt-1">Risk Score</span>
                    </div>
                  </div>

                  <h2 className="text-3xl md:text-4xl font-semibold tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-zinc-900 to-zinc-600 dark:from-zinc-50 dark:to-zinc-400 mb-4 leading-tight whitespace-pre-line">
                    {vc.headline}
                  </h2>
                  <p className="text-base text-zinc-500 dark:text-zinc-400 leading-relaxed font-light mb-6 max-w-sm">
                    {result.summary || vc.subtext}
                  </p>

                  {/* Scan ID + domain */}
                  <div className="flex flex-wrap gap-2 mb-8">
                    <span className="text-xs font-medium text-zinc-400 bg-black/5 dark:bg-white/5 px-2 py-1 rounded-md border border-black/5 dark:border-white/5 font-mono">
                      {result.scanId}
                    </span>
                    <span className="text-xs font-medium text-zinc-400 bg-black/5 dark:bg-white/5 px-2 py-1 rounded-md border border-black/5 dark:border-white/5 font-mono">
                      {result.domain}
                    </span>
                  </div>

                  <button
                    id="reset-btn"
                    onClick={resetApp}
                    className="flex items-center gap-2 px-6 py-3.5 rounded-full text-sm font-medium text-zinc-600 dark:text-zinc-300 bg-white dark:bg-white/[0.03] hover:bg-zinc-100 dark:hover:bg-white/[0.08] hover:text-zinc-900 dark:hover:text-white transition-all duration-500 border border-zinc-200 dark:border-white/[0.05] shadow-sm hover:shadow-md dark:shadow-none dark:hover:shadow-[0_0_20px_rgba(255,255,255,0.05)] active:scale-95 group"
                  >
                    <RefreshCw className="w-4 h-4 group-hover:-rotate-180 transition-transform duration-700" />
                    Analyze another offer
                  </button>
                </div>

                {/* ── RIGHT: AI Breakdown ─────────────────────────────── */}
                <div className="lg:col-span-7 flex flex-col">
                  <div className="flex items-center justify-between mb-6 reveal-epic delay-100">
                    <h3 className="text-xs font-semibold tracking-widest text-zinc-400 dark:text-zinc-500 uppercase">AI Threat Analysis</h3>
                    <span className="text-xs font-medium text-zinc-500 bg-black/5 dark:bg-white/5 px-2 py-1 rounded-md border border-black/5 dark:border-white/5 font-mono">
                      {result.scanId}
                    </span>
                  </div>

                  <div className="space-y-4">
                    {(result.issues || []).length === 0 && (
                      <div className="flex items-start gap-5 p-5 md:p-6 rounded-2xl bg-white dark:bg-[#0A0A0A] border border-zinc-200 dark:border-white/[0.05]">
                        <div className="w-10 h-10 rounded-full bg-green-50 dark:bg-green-500/10 flex items-center justify-center shrink-0 border border-green-100 dark:border-green-500/20">
                          <CheckCircle2 className="w-5 h-5 text-green-500" />
                        </div>
                        <div>
                          <h4 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-1">No major issues found</h4>
                          <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed font-light">
                            The offer appears legitimate based on our AI analysis. Always verify through official channels.
                          </p>
                        </div>
                      </div>
                    )}

                    {(result.issues || []).map((issue, idx) => {
                      const sv = getSeverity(issue);
                      const delayClass = idx === 0 ? 'delay-100' : idx === 1 ? 'delay-200' : 'delay-300';
                      return (
                        <div
                          key={idx}
                          className={`reveal-epic ${delayClass} flex items-start gap-5 p-5 md:p-6 rounded-2xl bg-white dark:bg-[#0A0A0A] border border-zinc-200 dark:border-white/[0.05] hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)] transition-all duration-500 group relative overflow-hidden`}
                        >
                          <div className={`absolute inset-0 bg-gradient-to-r ${sv.shimmer} translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000`} />
                          <div className={`w-10 h-10 rounded-full ${sv.iconBg} flex items-center justify-center shrink-0 border ${sv.iconBorder} group-hover:scale-110 transition-transform duration-500`}>
                            {sv.icon}
                          </div>
                          <div className="w-full">
                            <div className="flex justify-between items-start mb-1">
                              <h4 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{issue.title}</h4>
                              <span className={`text-[10px] font-bold tracking-wider uppercase ${sv.badgeText} ${sv.badgeBg} px-2 py-0.5 rounded-full shrink-0 ml-2`}>
                                {sv.badge}
                              </span>
                            </div>
                            <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed font-light mt-2">
                              {issue.description}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
