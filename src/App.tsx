import { GoogleGenAI } from "@google/genai";
import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, 
  Upload, 
  Plus, 
  Trash2, 
  Save, 
  FileSpreadsheet, 
  History, 
  Package, 
  Search,
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
  Printer,
  Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/src/lib/utils';

// --- Types ---

interface InvoiceItem {
  id: string;
  name: string;
  stockGroup: string;
  hsnCode: string;
  qty: number;
  unit: string;
  rate: number;
  gstRate: number;
}

interface Invoice {
  id: string;
  date: string;
  invNo: string;
  partyLedger: string;
  voucherType: string;
  items: InvoiceItem[];
  subtotal: number;
  gstAmount: number;
  roundOff: number;
  total: number;
}

interface StockItem {
  name: string;
  totalQty: number;
  totalValue: number;
}

// --- App Component ---

export default function App() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [currentParty, setCurrentParty] = useState('');
  const [currentInvNo, setCurrentInvNo] = useState('');
  const [currentVoucherType, setCurrentVoucherType] = useState('Purchase');
  const [currentDate, setCurrentDate] = useState(new Date().toISOString().split('T')[0]);
  const [currentItems, setCurrentItems] = useState<InvoiceItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAppendMode, setIsAppendMode] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'scanner' | 'history' | 'stock'>('scanner');
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load data from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('tallysync_invoices');
    if (saved) {
      try {
        setInvoices(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse saved invoices', e);
      }
    }
  }, []);

  // Save data to localStorage
  useEffect(() => {
    localStorage.setItem('tallysync_invoices', JSON.stringify(invoices));
  }, [invoices]);

  // --- OCR Logic ---

  const processImage = async (file: File, append = false) => {
    if (!append) setIsProcessing(true);
    if (!append) setStatusMessage('Analyzing invoice with AI...');
    
    try {
      // Convert file to base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
      });
      reader.readAsDataURL(file);
      const base64Data = await base64Promise;

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              { text: "Extract invoice details from this image with 100% accuracy on numeric values. Return ONLY a JSON object with these fields: partyLedger, invNo, date (YYYY-MM-DD), voucherType (Purchase/Sales), items (array of {name, qty, rate, gstRate, hsnCode, stockGroup, unit}). Ensure 'qty' and 'rate' are precise numbers with decimals if present. If a field is not found, use a reasonable default or empty string." },
              {
                inlineData: {
                  mimeType: file.type,
                  data: base64Data
                }
              }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json"
        }
      });

      const result = JSON.parse(response.text || '{}');
      console.log('AI Extracted Data:', result);

      // Only set header details if they are not already set or if this is the first page
      if (result.partyLedger && (!currentParty || !append)) setCurrentParty(result.partyLedger);
      if (result.invNo && (!currentInvNo || !append)) setCurrentInvNo(result.invNo);
      if (result.date && (!currentDate || !append)) setCurrentDate(result.date);
      if (result.voucherType && (!currentVoucherType || !append)) setCurrentVoucherType(result.voucherType);
      
      if (result.items && Array.isArray(result.items)) {
        const detectedItems: InvoiceItem[] = result.items.map((item: any) => ({
          id: Math.random().toString(36).substr(2, 9),
          name: item.name || 'Detected Item',
          stockGroup: item.stockGroup || 'General',
          hsnCode: item.hsnCode || '',
          qty: parseFloat(item.qty) || 1,
          unit: item.unit || 'pcs',
          rate: parseFloat(item.rate) || 0,
          gstRate: parseFloat(item.gstRate) || 18
        }));
        
        if (append) {
          setCurrentItems(prev => [...prev, ...detectedItems]);
        } else {
          setCurrentItems(detectedItems);
        }
      } else if (!append) {
        addItem('Detected Item', 1, 0, 18);
      }
      
      if (!append) {
        setStatusMessage('AI Scan complete!');
        setTimeout(() => setStatusMessage(''), 3000);
      }
    } catch (error) {
      console.error('AI OCR Error:', error);
      if (!append) setStatusMessage('AI Scan failed. Falling back to manual entry.');
    } finally {
      if (!append) setIsProcessing(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files) as File[];
      
      if (files.length > 1) {
        setIsProcessing(true);
        // Clear existing items if it's a fresh multi-scan and not in append mode
        if (!isAppendMode) setCurrentItems([]);
        
        for (let i = 0; i < files.length; i++) {
          setStatusMessage(`Processing page ${i + 1} of ${files.length}...`);
          await processImage(files[i], true);
        }
        
        setIsProcessing(false);
        setStatusMessage(`Successfully scanned ${files.length} pages!`);
        setTimeout(() => setStatusMessage(''), 3000);
      } else {
        await processImage(files[0], isAppendMode);
      }
      
      setIsAppendMode(false);
      // Reset input value to allow re-uploading same file if needed
      e.target.value = '';
    }
  };

  const scanMorePages = () => {
    setIsAppendMode(true);
    fileInputRef.current?.click();
  };

  // --- Invoice Logic ---

  const addItem = (name = '', qty = 1, rate = 0, gstRate = 18) => {
    const newItem: InvoiceItem = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      stockGroup: 'General',
      hsnCode: '',
      qty,
      unit: 'pcs',
      rate,
      gstRate
    };
    setCurrentItems(prev => [...prev, newItem]);
  };

  const updateItem = (id: string, field: keyof InvoiceItem, value: string | number) => {
    setCurrentItems(prev => prev.map(item => {
      if (item.id === id) {
        return { ...item, [field]: value };
      }
      return item;
    }));
  };

  const removeItem = (id: string) => {
    setCurrentItems(prev => prev.filter(item => item.id !== id));
  };

  const calculateItemAmount = (item: InvoiceItem) => {
    return item.qty * item.rate;
  };

  const calculateSubtotal = () => {
    return currentItems.reduce((sum, item) => sum + calculateItemAmount(item), 0);
  };

  const calculateGstTotal = () => {
    return currentItems.reduce((sum, item) => {
      const amount = calculateItemAmount(item);
      return sum + (amount * item.gstRate / 100);
    }, 0);
  };

  const calculateFinalTotal = () => {
    const subtotal = calculateSubtotal();
    const gst = calculateGstTotal();
    const rawTotal = subtotal + gst;
    const roundedTotal = Math.round(rawTotal);
    const roundOff = roundedTotal - rawTotal;
    return { subtotal, gst, roundOff, total: roundedTotal };
  };

  const saveInvoice = () => {
    if (!currentParty || currentItems.length === 0) {
      alert('Please enter party ledger and at least one item.');
      return;
    }
    setShowReviewModal(true);
  };

  const confirmSave = () => {
    const { subtotal, gst, roundOff, total } = calculateFinalTotal();

    const newInvoice: Invoice = {
      id: Date.now().toString(),
      date: currentDate,
      invNo: currentInvNo,
      partyLedger: currentParty,
      voucherType: currentVoucherType,
      items: [...currentItems],
      subtotal,
      gstAmount: gst,
      roundOff,
      total
    };

    setInvoices(prev => [newInvoice, ...prev]);
    
    // Reset form
    setCurrentParty('');
    setCurrentInvNo('');
    setCurrentItems([]);
    setCurrentDate(new Date().toISOString().split('T')[0]);
    setShowReviewModal(false);
    setActiveTab('history');
    
    alert('Invoice saved successfully!');
  };

  const editInvoice = (inv: Invoice) => {
    setCurrentParty(inv.partyLedger);
    setCurrentInvNo(inv.invNo);
    setCurrentDate(inv.date);
    setCurrentVoucherType(inv.voucherType);
    setCurrentItems(inv.items);
    setEditingInvoiceId(inv.id);
    setActiveTab('scanner');
    setInvoices(prev => prev.filter(i => i.id !== inv.id));
  };

  // --- History Filtering ---
  const filteredInvoices = invoices.filter(inv => 
    inv.partyLedger.toLowerCase().includes(searchQuery.toLowerCase()) ||
    inv.invNo.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const historyGrandTotal = filteredInvoices.reduce((sum, inv) => sum + inv.total, 0);

  const deleteInvoice = (id: string) => {
    if (confirm('Are you sure you want to delete this invoice?')) {
      setInvoices(prev => prev.filter(inv => inv.id !== id));
    }
  };

  const clearAllInvoices = () => {
    if (confirm('Are you sure you want to clear ALL invoices? This cannot be undone.')) {
      setInvoices([]);
    }
  };

  // --- Stock Logic ---

  const getStockSummary = (): StockItem[] => {
    const stockMap: Record<string, { qty: number; val: number }> = {};
    
    invoices.forEach(inv => {
      inv.items.forEach(item => {
        const name = item.name.trim() || 'Unnamed Item';
        if (!stockMap[name]) stockMap[name] = { qty: 0, val: 0 };
        stockMap[name].qty += item.qty;
        stockMap[name].val += calculateItemAmount(item);
      });
    });

    return Object.entries(stockMap).map(([name, data]) => ({
      name,
      totalQty: data.qty,
      totalValue: data.val
    }));
  };

  // --- Export Logic ---

  const exportCurrentInvoiceCSV = () => {
    if (!currentParty || currentItems.length === 0) {
      alert('Please enter party ledger and at least one item to export.');
      return;
    }

    const { total, roundOff } = calculateFinalTotal();
    
    // Header based on Excel screenshot
    let csv = "Voucher Date,Voucher Type,Voucher No,Ledger Name,Item Name,ledger Tax,Billed Qty,Item Rate,Item Amount,cgst Amt,sgst Amt,Total AMT,Roundup,csgt,sgst\n";
    
    currentItems.forEach(item => {
      const itemAmount = item.qty * item.rate;
      const gstHalf = (itemAmount * item.gstRate / 100) / 2;
      
      csv += `${currentDate},${currentVoucherType},${currentInvNo},${currentParty},${item.name},${currentVoucherType},${item.qty},${item.rate},${itemAmount},${gstHalf.toFixed(2)},${gstHalf.toFixed(2)},${total.toFixed(2)},${roundOff.toFixed(2)},Input CGST,Input SGST\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `invoice_${currentParty.replace(/\s+/g, '_') || 'Current'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCSV = () => {
    // Header based on Excel screenshot
    let csv = "Voucher Date,Voucher Type,Voucher No,Ledger Name,Item Name,ledger Tax,Billed Qty,Item Rate,Item Amount,cgst Amt,sgst Amt,Total AMT,Roundup,csgt,sgst\n";
    
    invoices.forEach(inv => {
      inv.items.forEach(item => {
        const itemAmount = item.qty * item.rate;
        const gstHalf = (itemAmount * item.gstRate / 100) / 2;
        
        csv += `${inv.date},${inv.voucherType},${inv.invNo},${inv.partyLedger},${item.name},${inv.voucherType},${item.qty},${item.rate},${itemAmount},${gstHalf.toFixed(2)},${gstHalf.toFixed(2)},${inv.total.toFixed(2)},${inv.roundOff.toFixed(2)},Input CGST,Input SGST\n`;
      });
    });
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `invoice_${currentParty.replace(/\s+/g, '_') || 'Daybook'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportStockCSV = () => {
    const summary = getStockSummary();
    let csv = "Item Name,Stock Group,Units,HSN Code,Total Qty,Total Value\n";
    
    // Get HSN and Group from the first occurrence in invoices
    summary.forEach(s => {
      let hsn = '';
      let group = '';
      let unit = '';
      for (const inv of invoices) {
        const item = inv.items.find(i => i.name === s.name);
        if (item) {
          hsn = item.hsnCode;
          group = item.stockGroup;
          unit = item.unit;
          break;
        }
      }
      csv += `${s.name},${group},${unit},${hsn},${s.totalQty},${s.totalValue.toFixed(2)}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Stock_Summary_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const deleteStockItem = (name: string) => {
    if (confirm(`Are you sure you want to delete all records for "${name}"?`)) {
      setInvoices(prev => prev.map(inv => ({
        ...inv,
        items: inv.items.filter(item => item.name !== name)
      })).filter(inv => inv.items.length > 0));
    }
  };

  // --- UI Components ---

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#212529] font-sans">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-[#005A64] rounded-xl flex items-center justify-center text-white">
              <Camera size={24} />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-[#005A64]">Tally Prime<span className="text-[#008B9B]">TP</span></h1>
          </div>
          
          <nav className="flex gap-1 bg-gray-100 p-1 rounded-lg">
            <button 
              onClick={() => setActiveTab('scanner')}
              className={cn(
                "px-4 py-1.5 rounded-md text-sm font-medium transition-all",
                activeTab === 'scanner' ? "bg-white text-[#2C3E50] shadow-sm" : "text-gray-500 hover:text-gray-700"
              )}
            >
              Scanner
            </button>
            <button 
              onClick={() => setActiveTab('history')}
              className={cn(
                "px-4 py-1.5 rounded-md text-sm font-medium transition-all",
                activeTab === 'history' ? "bg-white text-[#2C3E50] shadow-sm" : "text-gray-500 hover:text-gray-700"
              )}
            >
              Day Book
            </button>
            <button 
              onClick={() => setActiveTab('stock')}
              className={cn(
                "px-4 py-1.5 rounded-md text-sm font-medium transition-all",
                activeTab === 'stock' ? "bg-white text-[#2C3E50] shadow-sm" : "text-gray-500 hover:text-gray-700"
              )}
            >
              Stock
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <AnimatePresence mode="wait">
          {activeTab === 'scanner' && (
            <motion.div 
              key="scanner"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Upload Section */}
              <section className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Camera size={20} className="text-[#2C3E50]" />
                  Scan Invoice
                </h2>
                
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-200 rounded-xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-[#27AE60] hover:bg-green-50/30 transition-all group"
                >
                  <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center text-gray-400 group-hover:bg-[#27AE60]/10 group-hover:text-[#27AE60] transition-colors">
                    <Upload size={24} />
                  </div>
                  <div className="text-center">
                    <p className="font-medium text-gray-700">Click to upload or take a photo</p>
                    <p className="text-sm text-gray-400">Supports multiple JPG, PNG (Max 10MB each)</p>
                  </div>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileChange} 
                    accept="image/*" 
                    multiple
                    className="hidden" 
                  />
                </div>

                {isProcessing && (
                  <div className="mt-4 flex items-center gap-3 text-[#F39C12] font-medium bg-amber-50 p-3 rounded-lg border border-amber-100">
                    <Loader2 size={20} className="animate-spin" />
                    {statusMessage}
                  </div>
                )}

                {!isProcessing && statusMessage && (
                  <div className="mt-4 flex items-center gap-3 text-[#27AE60] font-medium bg-green-50 p-3 rounded-lg border border-green-100">
                    <CheckCircle2 size={20} />
                    {statusMessage}
                  </div>
                )}

                {currentItems.length > 0 && !isProcessing && (
                  <div className="mt-4 flex justify-center">
                    <button 
                      onClick={scanMorePages}
                      className="flex items-center gap-2 px-4 py-2 bg-[#F1F5F9] hover:bg-gray-200 text-[#005A64] rounded-lg font-bold transition-colors text-sm"
                    >
                      <Plus size={16} />
                      Scan More Pages
                    </button>
                  </div>
                )}
              </section>

              {/* Details Section */}
              <section className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                <h2 className="text-lg font-semibold mb-6 text-[#005A64]">Extracted Invoice Details</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-500">Party Ledger</label>
                    <input 
                      value={currentParty}
                      onChange={(e) => setCurrentParty(e.target.value)}
                      placeholder="Vendor / Customer Name"
                      className="w-full px-4 py-2 bg-[#F1F5F9] border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#005A64]/10 focus:border-[#005A64] outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-500">Invoice Number</label>
                    <input 
                      value={currentInvNo}
                      onChange={(e) => setCurrentInvNo(e.target.value)}
                      placeholder="277"
                      className="w-full px-4 py-2 bg-[#F1F5F9] border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#005A64]/10 focus:border-[#005A64] outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-500">Voucher Type</label>
                    <select 
                      value={currentVoucherType}
                      onChange={(e) => setCurrentVoucherType(e.target.value)}
                      className="w-full px-4 py-2 bg-[#F1F5F9] border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#005A64]/10 focus:border-[#005A64] outline-none transition-all appearance-none"
                    >
                      <option>Purchase</option>
                      <option>Sales</option>
                      <option>Payment</option>
                      <option>Receipt</option>
                    </select>
                  </div>
                </div>

                <div className="mt-8">
                  <h3 className="text-md font-bold text-[#005A64] mb-4">Items</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="text-left py-3 px-2 text-xs font-bold text-gray-400 uppercase tracking-wider">Item Name</th>
                          <th className="text-left py-3 px-2 text-xs font-bold text-gray-400 uppercase tracking-wider w-24">Stock Group</th>
                          <th className="text-left py-3 px-2 text-xs font-bold text-gray-400 uppercase tracking-wider w-24">HSN Code</th>
                          <th className="text-left py-3 px-2 text-xs font-bold text-gray-400 uppercase tracking-wider w-24">Quantity</th>
                          <th className="text-left py-3 px-2 text-xs font-bold text-gray-400 uppercase tracking-wider w-20">Units</th>
                          <th className="text-left py-3 px-2 text-xs font-bold text-gray-400 uppercase tracking-wider w-24">GST Rate (%)</th>
                          <th className="text-right py-3 px-2 text-xs font-bold text-gray-400 uppercase tracking-wider w-32">Amount (excl. GST)</th>
                          <th className="w-12"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentItems.map((item) => (
                          <tr key={item.id} className="border-b border-gray-50 group">
                            <td className="py-3 px-2">
                              <input 
                                value={item.name}
                                onChange={(e) => updateItem(item.id, 'name', e.target.value)}
                                className="w-full px-3 py-2 bg-[#F1F5F9] border border-gray-100 rounded-lg outline-none focus:border-[#005A64] font-medium text-sm"
                                placeholder="Item description"
                              />
                            </td>
                            <td className="py-3 px-2">
                              <input 
                                value={item.stockGroup}
                                onChange={(e) => updateItem(item.id, 'stockGroup', e.target.value)}
                                className="w-full px-3 py-2 bg-[#F1F5F9] border border-gray-100 rounded-lg outline-none focus:border-[#005A64] font-medium text-sm"
                              />
                            </td>
                            <td className="py-3 px-2">
                              <input 
                                value={item.hsnCode}
                                onChange={(e) => updateItem(item.id, 'hsnCode', e.target.value)}
                                className="w-full px-3 py-2 bg-[#F1F5F9] border border-gray-100 rounded-lg outline-none focus:border-[#005A64] font-medium text-sm"
                              />
                            </td>
                            <td className="py-3 px-2">
                              <input 
                                type="number"
                                value={item.qty}
                                onChange={(e) => updateItem(item.id, 'qty', parseFloat(e.target.value) || 0)}
                                className="w-full px-3 py-2 bg-[#F1F5F9] border border-gray-100 rounded-lg outline-none focus:border-[#005A64] font-medium text-sm"
                              />
                            </td>
                            <td className="py-3 px-2">
                              <input 
                                value={item.unit}
                                onChange={(e) => updateItem(item.id, 'unit', e.target.value)}
                                className="w-full px-3 py-2 bg-[#F1F5F9] border border-gray-100 rounded-lg outline-none focus:border-[#005A64] font-medium text-sm"
                              />
                            </td>
                            <td className="py-3 px-2">
                              <input 
                                type="number"
                                value={item.gstRate}
                                onChange={(e) => updateItem(item.id, 'gstRate', parseFloat(e.target.value) || 0)}
                                className="w-full px-3 py-2 bg-[#F1F5F9] border border-gray-100 rounded-lg outline-none focus:border-[#005A64] font-medium text-sm"
                              />
                            </td>
                            <td className="py-3 px-2 text-right">
                              <input 
                                type="number"
                                value={item.rate}
                                onChange={(e) => updateItem(item.id, 'rate', parseFloat(e.target.value) || 0)}
                                className="w-full px-3 py-2 bg-[#F1F5F9] border border-gray-100 rounded-lg outline-none focus:border-[#005A64] font-medium text-sm text-right"
                              />
                            </td>
                            <td className="py-3 px-2 text-right">
                              <button 
                                onClick={() => removeItem(item.id)}
                                className="p-2 text-red-400 hover:bg-red-50 rounded-lg transition-colors"
                              >
                                <Trash2 size={18} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <button 
                  onClick={() => addItem()}
                  className="mt-6 px-4 py-2 bg-[#F1F5F9] hover:bg-gray-200 text-[#005A64] rounded-lg font-bold flex items-center gap-2 transition-colors"
                >
                  <Plus size={18} />
                  Add Item
                </button>

                <div className="mt-12 flex flex-col md:flex-row justify-between gap-8">
                  <div className="flex-1 space-y-4">
                    <div className="space-y-1.5 max-w-xs">
                      <label className="text-xs font-bold text-gray-500">Date</label>
                      <input 
                        type="date"
                        value={currentDate}
                        onChange={(e) => setCurrentDate(e.target.value)}
                        className="w-full px-4 py-2 bg-[#F1F5F9] border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#005A64]/10 focus:border-[#005A64] outline-none transition-all"
                      />
                    </div>
                  </div>

                  <div className="w-full md:w-80 space-y-3">
                    <div className="flex justify-between text-gray-600">
                      <span className="font-medium">Subtotal:</span>
                      <span className="font-bold">₹{calculateSubtotal().toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-gray-600">
                      <span className="font-medium">GST:</span>
                      <span className="font-bold">₹{calculateGstTotal().toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-gray-600">
                      <span className="font-medium">Round Off:</span>
                      <span className="font-bold">₹{calculateFinalTotal().roundOff.toFixed(2)}</span>
                    </div>
                    <div className="pt-3 border-t border-gray-200 flex justify-between items-center">
                      <span className="text-lg font-bold text-[#005A64]">Total:</span>
                      <span className="text-2xl font-black text-[#005A64]">₹{calculateFinalTotal().total.toFixed(2)}</span>
                    </div>
                    
                    <div className="flex flex-col gap-3 mt-6">
                      <button 
                        onClick={saveInvoice}
                        className="w-full px-8 py-4 bg-[#005A64] hover:bg-[#004A52] text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-teal-100 transition-all active:scale-95"
                      >
                        <Save size={20} />
                        Save to Day Book
                      </button>
                      
                      <button 
                        onClick={exportCurrentInvoiceCSV}
                        className="w-full px-8 py-4 bg-white border border-gray-200 hover:bg-gray-50 text-[#2C3E50] rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95"
                      >
                        <FileSpreadsheet size={20} />
                        Export to Excel
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            </motion.div>
          )}

          {activeTab === 'history' && (
            <motion.div 
              key="history"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                  <h2 className="text-3xl font-bold text-[#2C3E50]">Day Book</h2>
                  
                  <div className="flex items-center gap-3">
                    <div className="relative flex-1 md:w-64">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                      <input 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search by party..."
                        className="w-full pl-10 pr-4 py-2 bg-[#F1F5F9] border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#005A64]/10 focus:border-[#005A64] outline-none transition-all"
                      />
                    </div>
                    <button 
                      onClick={() => setActiveTab('scanner')}
                      className="p-2 bg-[#008B9B]/10 text-[#008B9B] rounded-lg hover:bg-[#008B9B]/20 transition-colors"
                    >
                      <Plus size={20} />
                    </button>
                    <button 
                      onClick={clearAllInvoices}
                      className="p-2 bg-red-50 text-red-500 rounded-lg hover:bg-red-100 transition-colors"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-gray-400 text-sm font-bold border-b border-gray-50">
                        <th className="text-left py-4 px-2 font-bold uppercase tracking-wider">Date</th>
                        <th className="text-left py-4 px-2 font-bold uppercase tracking-wider">Invoice No.</th>
                        <th className="text-left py-4 px-2 font-bold uppercase tracking-wider">Party Ledger</th>
                        <th className="text-right py-4 px-2 font-bold uppercase tracking-wider">Total</th>
                        <th className="text-right py-4 px-2 font-bold uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filteredInvoices.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-12 text-center text-gray-400">
                            <div className="flex flex-col items-center gap-2">
                              <Search size={32} className="opacity-20" />
                              <p>No invoices found</p>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        filteredInvoices.map((inv) => (
                          <tr key={inv.id} className="hover:bg-gray-50/50 transition-colors">
                            <td className="py-4 px-2 text-gray-600">{inv.date}</td>
                            <td className="py-4 px-2 font-bold text-[#2C3E50]">{inv.invNo}</td>
                            <td className="py-4 px-2 font-bold text-[#2C3E50] uppercase">{inv.partyLedger}</td>
                            <td className="py-4 px-2 text-right font-bold text-[#2C3E50]">{inv.total.toFixed(2)}</td>
                            <td className="py-4 px-2 text-right flex justify-end gap-2">
                              <button 
                                onClick={() => editInvoice(inv)}
                                className="p-2 bg-[#005A64] text-white rounded-lg hover:bg-[#004A52] transition-colors group relative"
                                title="Edit Invoice"
                              >
                                <FileSpreadsheet size={18} />
                                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                                  Edit Invoice
                                </span>
                              </button>
                              <button 
                                onClick={() => deleteInvoice(inv.id)}
                                className="p-2 bg-red-50 text-red-500 rounded-lg hover:bg-red-100 transition-colors"
                                title="Delete Invoice"
                              >
                                <Trash2 size={18} />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="mt-8 flex justify-end items-center gap-4">
                  <span className="text-xl font-bold text-gray-400">Grand Total:</span>
                  <div className="px-8 py-2 bg-[#F1F5F9] rounded-lg text-xl font-black text-[#2C3E50] min-w-[150px] text-right">
                    {historyGrandTotal.toFixed(2)}
                  </div>
                </div>
              </div>
              
              <div className="flex justify-center">
                <button 
                  onClick={exportCSV}
                  className="flex items-center gap-2 px-6 py-3 bg-white border border-gray-200 rounded-xl text-sm font-bold text-[#2C3E50] hover:bg-gray-50 transition-all shadow-sm"
                >
                  <FileSpreadsheet size={18} />
                  Export to Excel
                </button>
              </div>
            </motion.div>
          )}

          {activeTab === 'stock' && (
            <motion.div 
              key="stock"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                  <h2 className="text-3xl font-bold text-[#2C3E50]">Stock Summary</h2>
                  
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={exportStockCSV}
                      className="p-2 bg-gray-50 text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
                      title="Export Stock to Excel"
                    >
                      <Download size={20} />
                    </button>
                    <button 
                      className="p-2 bg-gray-50 text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
                      title="Print Summary"
                    >
                      <Printer size={20} />
                    </button>
                    <button 
                      onClick={() => {
                        if (confirm('Clear all stock data?')) setInvoices([]);
                      }}
                      className="p-2 bg-red-50 text-red-500 rounded-lg hover:bg-red-100 transition-colors"
                      title="Clear All Stock"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-gray-400 text-sm font-bold border-b border-gray-50">
                        <th className="text-left py-4 px-2 font-bold uppercase tracking-wider">Item Name</th>
                        <th className="text-left py-4 px-2 font-bold uppercase tracking-wider">Stock Group</th>
                        <th className="text-left py-4 px-2 font-bold uppercase tracking-wider">Units</th>
                        <th className="text-left py-4 px-2 font-bold uppercase tracking-wider">HSN Code</th>
                        <th className="text-left py-4 px-2 font-bold uppercase tracking-wider">GST Rate (%)</th>
                        <th className="text-right py-4 px-2 font-bold uppercase tracking-wider">Total Qty</th>
                        <th className="text-right py-4 px-2 font-bold uppercase tracking-wider">Total Value</th>
                        <th className="w-12"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {getStockSummary().length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-12 text-center text-gray-400">
                            <div className="flex flex-col items-center gap-2">
                              <Package size={32} className="opacity-20" />
                              <p>No stock items found</p>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        getStockSummary().map((item) => {
                          // Find metadata from first occurrence
                          let hsn = '';
                          let group = '';
                          let unit = '';
                          let gst = 0;
                          for (const inv of invoices) {
                            const found = inv.items.find(i => i.name === item.name);
                            if (found) {
                              hsn = found.hsnCode;
                              group = found.stockGroup;
                              unit = found.unit;
                              gst = found.gstRate;
                              break;
                            }
                          }

                          return (
                            <tr key={item.name} className="hover:bg-gray-50/50 transition-colors">
                              <td className="py-4 px-2 font-bold text-[#2C3E50]">{item.name}</td>
                              <td className="py-4 px-2">
                                <span className="px-3 py-1 bg-gray-100 text-gray-600 rounded-md text-xs font-medium">
                                  {group}
                                </span>
                              </td>
                              <td className="py-4 px-2 text-gray-600">{unit}</td>
                              <td className="py-4 px-2 text-gray-600 font-mono">{hsn}</td>
                              <td className="py-4 px-2 text-gray-600">{gst}</td>
                              <td className="py-4 px-2 text-right font-bold text-[#2C3E50]">{item.totalQty}</td>
                              <td className="py-4 px-2 text-right font-bold text-[#27AE60]">₹{item.totalValue.toFixed(2)}</td>
                              <td className="py-4 px-2 text-right">
                                <button 
                                  onClick={() => deleteStockItem(item.name)}
                                  className="text-gray-300 hover:text-red-500 transition-colors"
                                >
                                  <Trash2 size={18} />
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="max-w-5xl mx-auto px-4 py-12 text-center">
        <p className="text-sm text-gray-400">© 2026 TallySync Pro. All data is stored locally on your device.</p>
      </footer>

      {/* Review Modal */}
      <AnimatePresence>
        {showReviewModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowReviewModal(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-[#005A64] text-white">
                <h3 className="text-xl font-bold">Review Invoice</h3>
                <button onClick={() => setShowReviewModal(false)} className="p-1 hover:bg-white/10 rounded-full transition-colors">
                  <X size={24} />
                </button>
              </div>
              
              <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-8">
                  <div>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Party Ledger</p>
                    <p className="text-lg font-bold text-[#2C3E50]">{currentParty}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Invoice Number</p>
                    <p className="text-lg font-bold text-[#2C3E50]">{currentInvNo}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Voucher Type</p>
                    <p className="text-lg font-bold text-[#2C3E50]">{currentVoucherType}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Date</p>
                    <p className="text-lg font-bold text-[#2C3E50]">{currentDate}</p>
                  </div>
                </div>

                <div className="border-t border-gray-100 pt-6">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Item Summary</p>
                  <div className="space-y-2">
                    {currentItems.map(item => (
                      <div key={item.id} className="flex justify-between items-center text-sm">
                        <span className="text-gray-600 font-medium">{item.name} ({item.qty} {item.unit})</span>
                        <span className="font-bold text-[#2C3E50]">₹{calculateItemAmount(item).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-[#F1F5F9] rounded-2xl p-6 space-y-3">
                  <div className="flex justify-between text-gray-600 text-sm">
                    <span>Subtotal</span>
                    <span className="font-bold">₹{calculateSubtotal().toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-600 text-sm">
                    <span>GST Total</span>
                    <span className="font-bold">₹{calculateGstTotal().toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-600 text-sm">
                    <span>Round Off</span>
                    <span className="font-bold">₹{calculateFinalTotal().roundOff.toFixed(2)}</span>
                  </div>
                  <div className="pt-3 border-t border-gray-200 flex justify-between items-center">
                    <span className="text-lg font-bold text-[#005A64]">Final Total</span>
                    <span className="text-2xl font-black text-[#005A64]">₹{calculateFinalTotal().total.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              <div className="p-6 bg-gray-50 flex gap-4">
                <button 
                  onClick={() => setShowReviewModal(false)}
                  className="flex-1 px-6 py-3 border border-gray-200 rounded-xl font-bold text-gray-600 hover:bg-white transition-all"
                >
                  Back to Edit
                </button>
                <button 
                  onClick={confirmSave}
                  className="flex-1 px-6 py-3 bg-[#27AE60] hover:bg-[#219150] text-white rounded-xl font-bold shadow-lg shadow-green-100 transition-all active:scale-95"
                >
                  Confirm & Save
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
