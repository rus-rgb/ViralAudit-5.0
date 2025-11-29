import React, { useState, useEffect, useContext, createContext } from "react";
import { createRoot } from "react-dom/client";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@supabase/supabase-js";

// ==========================================
// ⚙️ CONFIGURATION
// ==========================================
const WORKER_URL = "https://damp-wind-775f.rusdumitru122.workers.dev/"; 

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";

const supabase = (SUPABASE_URL && SUPABASE_KEY) 
    ? createClient(SUPABASE_URL, SUPABASE_KEY) 
    : null;

// ==========================================
// 🛠️ UTILS
// ==========================================

const scrollToSection = (e: React.MouseEvent, id: string) => {
  e.preventDefault();
  const element = document.getElementById(id);
  if (element) {
    element.scrollIntoView({ behavior: "smooth" });
  }
};

// ==========================================
// 🔐 AUTH CONTEXT
// ==========================================

type User = {
    email: string;
    id: string;
};

interface AuthContextType {
    user: User | null;
    isLoading: boolean;
    login: (e: string, p: string) => Promise<any>;
    signup: (e: string, p: string) => Promise<any>;
    logout: () => void;
    showAuthModal: boolean;
    setShowAuthModal: (show: boolean) => void;
    authView: 'login' | 'signup';
    setAuthView: (view: 'login' | 'signup') => void;
    openTool: () => void;
    triggerUpgrade: () => void; // New helper to scroll to pricing
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [showToolModal, setShowToolModal] = useState(false);
    const [authView, setAuthView] = useState<'login' | 'signup'>('signup');

    useEffect(() => {
        const checkSession = async () => {
            if(!supabase) {
                console.warn("Supabase not configured");
                setIsLoading(false);
                return;
            }
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
                setUser({ email: session.user.email!, id: session.user.id });
            }
            setIsLoading(false);
        };
        checkSession();

        const { data: { subscription } } = supabase?.auth.onAuthStateChange((_event, session) => {
            if (session?.user) {
                setUser({ email: session.user.email!, id: session.user.id });
            } else {
                setUser(null);
            }
        }) || { data: { subscription: null } };

        return () => subscription?.unsubscribe();
    }, []);

    const login = async (email: string, password: string) => {
        if(!supabase) return { error: { message: "Supabase not configured" } };
        const result = await supabase.auth.signInWithPassword({ email, password });
        if (!result.error) setShowAuthModal(false);
        return result;
    };

    const signup = async (email: string, password: string) => {
        if(!supabase) return { error: { message: "Supabase not configured" } };
        const result = await supabase.auth.signUp({ email, password });
        if (!result.error) setShowAuthModal(false);
        return result;
    };

    const logout = async () => {
        if(supabase) await supabase.auth.signOut();
        setUser(null);
    };

    const openTool = () => {
        setShowToolModal(true);
    };

    const triggerUpgrade = () => {
        setShowToolModal(false);
        const pricing = document.getElementById('pricing');
        if(pricing) pricing.scrollIntoView({ behavior: 'smooth' });
    };

    return (
        <AuthContext.Provider value={{ 
            user, isLoading, login, signup, logout,
            showAuthModal, setShowAuthModal,
            authView, setAuthView, openTool, triggerUpgrade
        }}>
            {children}
            <ViralAuditTool isOpen={showToolModal} onClose={() => setShowToolModal(false)} />
        </AuthContext.Provider>
    );
};

const useAuth = () => useContext(AuthContext);

// ==========================================
// 🚀 THE APP COMPONENT (VIDEO ANALYZER)
// ==========================================

const ViralAuditTool = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
    const { user, setShowAuthModal, setAuthView, triggerUpgrade } = useAuth();
    const [file, setFile] = useState<File | null>(null);
    const [analyzing, setAnalyzing] = useState(false);
    const [result, setResult] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    
    // 🆕 Usage State
    const [auditCount, setAuditCount] = useState<number>(0);
    const [loadingUsage, setLoadingUsage] = useState(false);
    const FREE_LIMIT = 3;

    // Load usage when tool opens
    useEffect(() => { 
        if(!isOpen) { 
            setFile(null); 
            setResult(null); 
            setError(null); 
        } else if (user && supabase) {
            loadUsage();
        }
    }, [isOpen, user]);

    const loadUsage = async () => {
        if(!user || !supabase) return;
        setLoadingUsage(true);
        // Fetch profile
        const { data, error } = await supabase
            .from('profiles')
            .select('audit_count')
            .eq('id', user.id)
            .single();
        
        if(data) setAuditCount(data.audit_count);
        // If error (profile missing), we assume 0 (it will be created by trigger usually)
        setLoadingUsage(false);
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            setError(null);
        }
    };

    const runAnalysis = async () => {
        if (!file || !user || !supabase) return;

        // 🛑 1. CHECK LIMIT
        if (auditCount >= FREE_LIMIT) {
            return; // UI handles the display, we just stop logic here
        }

        setAnalyzing(true);
        setError(null);

        try {
            const toBase64 = (f: File) => new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.readAsDataURL(f);
                reader.onload = () => resolve((reader.result as string).split(',')[1]);
                reader.onerror = error => reject(error);
            });

            const base64Data = await toBase64(file);

            const response = await fetch(WORKER_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    base64Data: base64Data,
                    mimeType: file.type,
                    licenseKey: user.email, 
                    systemPrompt: "" 
                })
            });

            const json = await response.json();

            if (json.error) throw new Error(json.error.message || "Analysis failed");
            if (!json.candidates?.[0]?.content?.parts?.[0]?.text) throw new Error("No analysis returned");

            setResult(json.candidates[0].content.parts[0].text);
            
            // ✅ 2. INCREMENT COUNT ON SUCCESS
            const newCount = auditCount + 1;
            setAuditCount(newCount);
            await supabase.from('profiles').update({ audit_count: newCount }).eq('id', user.id);

        } catch (err: any) {
            setError(err.message);
        } finally {
            setAnalyzing(false);
        }
    };

    const formatText = (text: string) => {
        return text
            .replace(/\*\*(.*?)\*\*/g, '<strong class="text-white">$1</strong>')
            .replace(/#HOOK/g, '<h3 class="text-[#00F2EA] border-b border-[#333] pb-1 mt-6 mb-2 text-lg font-bold">🪝 HOOK</h3>')
            .replace(/#BODY/g, '<h3 class="text-[#00F2EA] border-b border-[#333] pb-1 mt-6 mb-2 text-lg font-bold">📹 BODY</h3>')
            .replace(/#AUDIO/g, '<h3 class="text-[#00F2EA] border-b border-[#333] pb-1 mt-6 mb-2 text-lg font-bold">🔊 AUDIO</h3>')
            .replace(/#SCRIPT/g, '<h3 class="text-[#00F2EA] border-b border-[#333] pb-1 mt-6 mb-2 text-lg font-bold">📝 SCRIPT</h3>')
            .replace(/\n/g, '<br>');
    };

    // 🎨 UI HELPERS
    const isLimitReached = auditCount >= FREE_LIMIT;
    const remaining = Math.max(0, FREE_LIMIT - auditCount);

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 bg-black/80 backdrop-blur-md z-[150]" />
                    <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="fixed inset-0 z-[151] flex items-center justify-center p-4 pointer-events-none">
                        <div className="bg-[#111] border border-[#333] w-full max-w-2xl max-h-[90vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col pointer-events-auto">
                            
                            {/* Header */}
                            <div className="p-5 border-b border-[#222] flex justify-between items-center bg-[#161616]">
                                <h2 className="text-xl font-bold flex items-center gap-2">
                                    <span className="bg-gradient-to-r from-[#FF0050] to-[#00F2EA] bg-clip-text text-transparent">ViralAudit AI</span>
                                </h2>
                                <button onClick={onClose} className="text-gray-500 hover:text-white"><i className="fa-solid fa-xmark text-xl"></i></button>
                            </div>

                            <div className="p-6 overflow-y-auto flex-1 custom-scrollbar relative">
                                {!user ? (
                                    <div className="text-center py-10">
                                        <div className="w-16 h-16 rounded-full bg-[#1a1a1a] flex items-center justify-center border border-[#333] mb-4 mx-auto">
                                            <i className="fa-solid fa-lock text-2xl text-[#FF0050]"></i>
                                        </div>
                                        <h3 className="text-xl font-bold text-white mb-2">Login Required</h3>
                                        <p className="text-gray-400 mb-6">You must be logged in to use the Deep Audit tool.</p>
                                        <button onClick={() => { onClose(); setShowAuthModal(true); setAuthView('login'); }} className="bg-white text-black font-bold px-6 py-3 rounded-lg hover:bg-gray-200">Log In / Sign Up</button>
                                    </div>
                                ) : (
                                    <>
                                        {/* USAGE BAR */}
                                        {!result && (
                                            <div className="mb-6 flex items-center justify-between bg-[#1a1a1a] p-3 rounded-lg border border-[#333]">
                                                <div className="text-sm text-gray-400">
                                                    Free Audits: <span className={remaining === 0 ? "text-red-500 font-bold" : "text-white font-bold"}>{remaining}</span> / {FREE_LIMIT} left
                                                </div>
                                                {remaining === 0 && (
                                                    <button onClick={triggerUpgrade} className="text-xs bg-[#FF0050] text-white px-3 py-1 rounded font-bold hover:bg-red-600 transition-colors">
                                                        UPGRADE
                                                    </button>
                                                )}
                                            </div>
                                        )}

                                        {/* LIMIT REACHED STATE */}
                                        {isLimitReached && !result ? (
                                             <div className="text-center py-8">
                                                <div className="w-16 h-16 rounded-full bg-red-900/20 flex items-center justify-center border border-red-500/30 mb-4 mx-auto">
                                                    <i className="fa-solid fa-ban text-2xl text-red-500"></i>
                                                </div>
                                                <h3 className="text-xl font-bold text-white mb-2">Free Limit Reached</h3>
                                                <p className="text-gray-400 mb-6 max-w-sm mx-auto">You've used all 3 free audits. Upgrade to Pro for unlimited access and deep analysis.</p>
                                                <button onClick={triggerUpgrade} className="bg-white text-black font-bold px-8 py-3 rounded-lg hover:bg-gray-200 w-full sm:w-auto">
                                                    View Plans
                                                </button>
                                            </div>
                                        ) : !result ? (
                                            // UPLOAD STATE
                                            <div className="text-center">
                                                <div 
                                                    onClick={() => document.getElementById('app-file-upload')?.click()}
                                                    className={`border-2 border-dashed rounded-xl p-10 cursor-pointer transition-all ${file ? 'border-[#00F2EA] bg-[#00F2EA]/5' : 'border-[#333] hover:border-gray-500 hover:bg-[#1a1a1a]'}`}
                                                >
                                                    <input type="file" id="app-file-upload" className="hidden" accept="video/mp4,video/quicktime,video/webm" onChange={handleFileChange} />
                                                    <i className={`fa-solid ${file ? 'fa-check-circle text-[#00F2EA]' : 'fa-cloud-arrow-up text-gray-500'} text-4xl mb-4`}></i>
                                                    <h4 className="text-white font-medium text-lg">{file ? file.name : "Upload Video Ad"}</h4>
                                                    <p className="text-sm text-gray-500 mt-2">{file ? "Ready to analyze" : "MP4, MOV or WEBM (Max 20MB)"}</p>
                                                </div>

                                                {error && <p className="text-[#FF0050] text-sm mt-4 bg-[#FF0050]/10 p-3 rounded">{error}</p>}

                                                <button 
                                                    onClick={runAnalysis} 
                                                    disabled={!file || analyzing || loadingUsage}
                                                    className="w-full mt-6 bg-gradient-to-r from-[#FF0050] to-[#00F2EA] text-white font-bold py-4 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                                >
                                                    {analyzing ? <><i className="fa-solid fa-circle-notch fa-spin"></i> Analyzing...</> : "Run Deep Audit"}
                                                </button>
                                            </div>
                                        ) : (
                                            // RESULTS VIEW
                                            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
                                                <div className="flex items-center justify-between mb-4">
                                                    <h3 className="text-white font-bold text-lg">Analysis Report</h3>
                                                    <button onClick={() => setResult(null)} className="text-xs text-gray-500 hover:text-white underline">Audit Another</button>
                                                </div>
                                                <div 
                                                    className="prose prose-invert max-w-none text-sm text-gray-300 leading-relaxed"
                                                    dangerouslySetInnerHTML={{ __html: formatText(result) }}
                                                />
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}

// ==========================================
// 🧩 UI COMPONENTS
// ==========================================

const AuthModal = () => {
    const { showAuthModal, setShowAuthModal, login, signup, authView, setAuthView } = useAuth();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    if (!showAuthModal) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");
        
        let res;
        if (authView === 'login') {
            res = await login(email, password);
        } else {
            res = await signup(email, password);
        }

        if (res.error) {
            setError(res.error.message);
        }
        setLoading(false);
    };

    return (
        <AnimatePresence>
            {showAuthModal && (
                <>
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAuthModal(false)} className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[200] cursor-pointer" />
                    <div className="fixed inset-0 z-[201] flex items-center justify-center pointer-events-none p-4">
                        <motion.div initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }} className="bg-[#111] w-full max-w-md rounded-2xl border border-white/10 shadow-2xl pointer-events-auto overflow-hidden">
                            <div className="p-6 border-b border-white/5 flex justify-between items-center bg-[#151515]">
                                <h3 className="font-heading font-bold text-xl">{authView === 'login' ? 'Welcome Back' : 'Create Account'}</h3>
                                <button onClick={() => setShowAuthModal(false)} className="text-gray-500 hover:text-white transition-colors"><i className="fa-solid fa-xmark text-lg"></i></button>
                            </div>
                            <div className="p-8">
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div>
                                        <label className="block text-xs font-mono text-gray-500 uppercase mb-2">Email Address</label>
                                        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-white/30 transition-colors" placeholder="name@company.com" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-mono text-gray-500 uppercase mb-2">Password</label>
                                        <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-white/30 transition-colors" placeholder="••••••••" />
                                    </div>
                                    {error && <p className="text-[#FF0050] text-sm">{error}</p>}
                                    <button type="submit" disabled={loading} className="w-full bg-white text-black font-bold py-3.5 rounded-lg hover:bg-gray-200 transition-all mt-4 flex items-center justify-center gap-2">
                                        {loading ? <i className="fa-solid fa-circle-notch fa-spin"></i> : (authView === 'login' ? 'Sign In' : 'Create Free Account')}
                                    </button>
                                </form>
                                <div className="mt-6 text-center text-sm text-gray-500">
                                    {authView === 'login' ? <>Don't have an account? <button onClick={() => setAuthView('signup')} className="text-white hover:underline font-medium">Sign up</button></> : <>Already have an account? <button onClick={() => setAuthView('login')} className="text-white hover:underline font-medium">Sign in</button></>}
                                </div>
                            </div>
                        </motion.div>
                    </div>
                </>
            )}
        </AnimatePresence>
    );
};

const Navbar = () => {
  const [scrolled, setScrolled] = useState(false);
  const { user, logout, setShowAuthModal, setAuthView } = useAuth();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <nav className={`fixed w-full z-50 transition-all duration-300 ${scrolled ? "bg-black/80 backdrop-blur-xl border-b border-white/10 py-3" : "bg-transparent py-6"}`}>
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-10">
        <a href="#" className="flex items-center gap-2 z-10 group" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform"><i className="fa-solid fa-bolt text-black text-sm"></i></div>
            <span className="font-heading font-bold text-xl tracking-tight text-white group-hover:text-gray-200 transition-colors">ViralAudit</span>
        </a>
        <div className="hidden md:flex absolute left-1/2 -translate-x-1/2 gap-8 text-sm font-medium text-gray-400">
          <a href="#features" onClick={(e) => scrollToSection(e, "features")} className="hover:text-white transition-colors">Features</a>
          <a href="#pricing" onClick={(e) => scrollToSection(e, "pricing")} className="hover:text-white transition-colors">Pricing</a>
        </div>
        <div className="z-10 flex items-center gap-4">
          {user ? (
             <>
                 <span className="text-xs text-gray-400 hidden sm:block">{user.email}</span>
                 <button onClick={logout} className="text-sm font-medium text-white hover:text-gray-300 transition-colors">Logout</button>
             </>
          ) : (
             <>
                <button onClick={() => { setAuthView('login'); setShowAuthModal(true); }} className="text-sm font-medium text-gray-300 hover:text-white transition-colors hidden sm:block">Login</button>
                <button onClick={() => { setAuthView('signup'); setShowAuthModal(true); }} className="bg-white text-black px-6 py-2.5 rounded-lg font-bold text-sm hover:bg-gray-200 transition-all shadow-lg">Get Started</button>
             </>
          )}
        </div>
      </div>
    </nav>
  );
};

const Background = () => {
    const noiseSvg = "data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E";

    return (
        <div className="fixed inset-0 z-0 pointer-events-none">
            <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: `url("${noiseSvg}")` }}></div>
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]"></div>
            <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-purple-900/20 blur-[120px] rounded-full"></div>
            <div className="absolute top-[20%] right-[-10%] w-[600px] h-[600px] bg-blue-900/10 blur-[120px] rounded-full"></div>
        </div>
    )
}

const Hero = () => {
  const { openTool } = useAuth();

  return (
    <section className="relative pt-32 pb-12 px-6 md:pt-48 md:pb-24 overflow-hidden">
      <div className="max-w-7xl mx-auto text-center mb-10 relative z-10">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/5 text-xs font-medium text-gray-300 mb-8 backdrop-blur-sm">
            <span className="bg-gradient-to-r from-pink-500 to-purple-600 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow-lg">NEW</span>
            <span className="text-gray-300">AI Ad Audits are live</span>
        </motion.div>
        <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="text-5xl md:text-7xl font-bold font-heading tracking-tight mb-6 leading-[1.1]">
          Stop Guessing.<br/>Audit Your Ads Instantly.
        </motion.h1>
        <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          Upload your video creative and let our AI analyze your hooks, pacing, and copy for viral potential.
        </motion.p>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="flex flex-col sm:flex-row justify-center gap-4">
            <button onClick={openTool} className="bg-white text-black px-8 py-4 rounded-xl font-bold text-lg hover:scale-105 transition-transform shadow-[0_0_20px_rgba(255,255,255,0.3)]">
                Launch Audit Tool
            </button>
        </motion.div>
      </div>
    </section>
  );
};

const FeatureCard = ({ icon, title, desc, delay }: any) => (
    <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay }} whileHover={{ y: -5 }} className="p-8 rounded-2xl bg-[#0a0a0a]/80 backdrop-blur-sm border border-white/10 hover:border-white/20 transition-colors group">
        <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center mb-6 text-xl group-hover:bg-white group-hover:text-black transition-all duration-300"><i className={icon}></i></div>
        <h3 className="text-xl font-bold mb-3 font-heading">{title}</h3>
        <p className="text-gray-400 leading-relaxed text-sm">{desc}</p>
    </motion.div>
);

const Features = () => {
    return (
        <section id="features" className="py-24 relative z-10 scroll-mt-24">
            <div className="max-w-6xl mx-auto px-6">
                <div className="grid md:grid-cols-3 gap-6">
                    <FeatureCard icon="fa-solid fa-list-check" title="Frame-by-Frame Audit" desc="Detailed breakdown of your hook, body, and CTA." delay={0.1} />
                    <FeatureCard icon="fa-solid fa-wand-magic-sparkles" title="Actionable Fixes" desc="Don't just get a score. Get a 'Fix List' to improve ROAS." delay={0.2} />
                    <FeatureCard icon="fa-solid fa-shield-halved" title="Secure & Private" desc="Your creatives are analyzed and discarded. We don't train on your data." delay={0.3} />
                </div>
            </div>
        </section>
    );
};

// ==========================================
// 💲 PRICING COMPONENTS
// ==========================================

const PricingCard = ({ plan, price, description, features, isPro, delay }: any) => {
    const { user, setShowAuthModal, setAuthView } = useAuth();
    
    const handleAction = () => {
        if (user) {
            // Placeholder: In a real app, this would redirect to checkout
            alert("You are logged in! Redirecting to checkout...");
        } else {
            setAuthView('signup');
            setShowAuthModal(true);
        }
    };

    return (
        <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay }}
            className={`relative p-8 rounded-2xl border flex flex-col h-full ${isPro ? 'bg-[#0f0f0f]/90 backdrop-blur-md border-white/30 shadow-[0_0_30px_rgba(255,255,255,0.05)]' : 'bg-[#0a0a0a]/80 backdrop-blur-sm border-white/10'}`}
        >
            {isPro && (
                <div className="absolute top-0 right-0 bg-white text-black text-[10px] font-bold px-3 py-1 rounded-bl-xl rounded-tr-xl">
                    RECOMMENDED
                </div>
            )}
            <div className="mb-8">
                <h3 className="text-lg font-bold font-heading mb-2">{plan}</h3>
                <div className="flex items-baseline gap-1 mb-4">
                    <span className="text-4xl font-bold">{price}</span>
                    <span className="text-sm text-gray-500">/mo</span>
                </div>
                <p className="text-sm text-gray-400">{description}</p>
            </div>
            
            <ul className="space-y-4 mb-8 flex-1">
                {features.map((feature: any, i: number) => (
                    <li key={i} className={`flex items-center gap-3 text-sm ${feature.included ? 'text-gray-200' : 'text-gray-600'}`}>
                        <i className={`fa-solid ${feature.included ? 'fa-check text-emerald-500' : 'fa-xmark text-gray-700'}`}></i>
                        {feature.text}
                    </li>
                ))}
            </ul>

            <button 
                onClick={handleAction}
                className={`block w-full text-center py-4 rounded-xl font-bold text-sm transition-all ${
                isPro 
                ? 'bg-white text-black hover:bg-gray-200 hover:scale-[1.02]' 
                : 'border border-white/20 text-white hover:bg-white/5'
            }`}>
                {isPro ? 'Start Pro Trial' : 'Get Started'}
            </button>
        </motion.div>
    );
};

const Pricing = () => {
    return (
        <section id="pricing" className="py-24 border-t border-white/5 relative z-10 scroll-mt-24">
            <div className="max-w-5xl mx-auto px-6">
                <div className="text-center mb-16">
                    <h2 className="text-3xl md:text-5xl font-bold font-heading mb-6">Pay for performance.</h2>
                    <p className="text-gray-400">Simple pricing that scales with your ad spend.</p>
                </div>

                <div className="grid md:grid-cols-2 gap-8 max-w-3xl mx-auto">
                    <PricingCard 
                        plan="Starter"
                        price="£29"
                        description="For solo media buyers testing waters."
                        delay={0.1}
                        isPro={false}
                        features={[
                            { text: "50 Video Audits / Month", included: true },
                            { text: "Deep Think Analysis", included: true },
                            { text: "Detailed Fix Reports", included: true },
                            { text: "Viral Script Rewrites", included: false },
                            { text: "Policy Violation Check", included: false },
                            { text: "Competitor Benchmarking", included: false },
                        ]}
                    />
                    <PricingCard 
                        plan="Professional"
                        price="£49"
                        description="For agencies and scaling brands."
                        delay={0.2}
                        isPro={true}
                        features={[
                            { text: "500 Video Audits / Month", included: true },
                            { text: "Deep Think Analysis", included: true },
                            { text: "Detailed Fix Reports", included: true },
                            { text: "Viral Script Rewrites", included: true },
                            { text: "Policy Violation Check", included: true },
                            { text: "Competitor Benchmarking", included: true },
                        ]}
                    />
                </div>
                
                <div className="mt-12 text-center">
                    <p className="text-sm text-gray-500 flex items-center justify-center gap-2">
                        <i className="fa-solid fa-lock text-xs"></i> 
                        Secure payment processing via Lemon Squeezy. Cancel anytime.
                    </p>
                </div>
            </div>
        </section>
    );
};

const FloatingActionButton = () => {
    const { openTool } = useAuth();
    return (
        <motion.div 
            initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 1, type: "spring" }}
            className="fixed bottom-8 right-8 z-40"
        >
            <button 
                onClick={openTool}
                className="flex items-center gap-2 px-6 py-4 bg-white text-black font-bold rounded-full shadow-[0_0_30px_rgba(255,255,255,0.2)] hover:scale-105 transition-transform"
            >
                <i className="fa-solid fa-robot text-[#00F2EA]"></i>
                <span>Audit Ad</span>
            </button>
        </motion.div>
    );
}

const Footer = () => (
    <footer className="py-12 border-t border-white/5 bg-[#050505] text-xs text-gray-600 relative z-10">
        <div className="max-w-6xl mx-auto px-6 flex justify-between items-center">
            <div className="flex items-center gap-2">
                 <div className="w-6 h-6 bg-white/10 rounded flex items-center justify-center"><i className="fa-solid fa-bolt text-gray-400 text-[10px]"></i></div>
                 <span className="font-bold text-gray-400">ViralAudit</span>
            </div>
            <div>&copy; 2025 ViralAudit Inc.</div>
        </div>
    </footer>
);

const App = () => {
  return (
    <AuthProvider>
        <div className="min-h-screen bg-black text-white selection:bg-pink-500/30 selection:text-white overflow-hidden">
            <Background />
            <Navbar />
            <Hero />
            <Features />
            <Pricing />
            <Footer />
            <FloatingActionButton />
            <AuthModal /> 
        </div>
    </AuthProvider>
  );
};

const container = document.getElementById("root");
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}

export default App;
