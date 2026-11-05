const express = require('express');
const { DatabaseSync } = require('node:sqlite'); // built into Node 22.13+ (no native build needed)
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, 'data');
const UPLOADS = path.join(__dirname, 'uploads');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });

// ---- JWT secret (env var, or generated once and stored) ----
const secretFile = path.join(DATA, 'secret.txt');
if (!process.env.JWT_SECRET && !fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(48).toString('hex'));
const JWT_SECRET = process.env.JWT_SECRET || fs.readFileSync(secretFile, 'utf8');

// ---- Database ----
const db = new DatabaseSync(path.join(DATA, 'lostfound.db'));
db.exec('PRAGMA foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('student','admin')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('lost','found')), title TEXT NOT NULL, description TEXT NOT NULL,
  category TEXT NOT NULL, location TEXT NOT NULL, item_date TEXT NOT NULL, image TEXT, contact TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','returned')), created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(item_id, user_id));
`);
if (!db.prepare("SELECT 1 FROM users WHERE role='admin'").get()) {
  db.prepare('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)')
    .run('Administrator', 'admin@campus.edu', bcrypt.hashSync('admin123', 10), 'admin');
  console.log('Default admin created: admin@campus.edu / admin123  (change it!)');
}

const CATEGORIES = ['Electronics', 'Books & Notes', 'ID / Cards', 'Keys', 'Clothing', 'Bags', 'Wallets', 'Accessories', 'Other'];
const fail = (res, code, msg) => res.status(code).json({ error: msg });
const clean = v => (typeof v === 'string' ? v.trim() : '');

// ---- Auth middleware ----
function readUser(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  try {
    const p = jwt.verify(h.slice(7), JWT_SECRET);
    return db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(p.id) || null;
  } catch { return null; }
}
const optionalAuth = (req, res, next) => { req.user = readUser(req); next(); };
const auth = (req, res, next) => { req.user = readUser(req); req.user ? next() : fail(res, 401, 'Please log in first.'); };
const adminOnly = (req, res, next) => (req.user.role === 'admin' ? next() : fail(res, 403, 'Admins only.'));

// ---- Upload handling ----
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + EXT[file.mimetype]),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => (EXT[file.mimetype] ? cb(null, true) : cb(new Error('Only JPG, PNG, GIF or WEBP images are allowed.'))),
});
const removeImage = name => { if (name) fs.unlink(path.join(UPLOADS, path.basename(name)), () => {}); };

const app = express();
app.use(express.json());
app.use('/uploads', express.static(UPLOADS, { index: false, setHeaders: r => r.setHeader('X-Content-Type-Options', 'nosniff') }));
app.use(express.static(path.join(__dirname, 'public')));

const sign = u => jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: '7d' });

// ---- Auth routes ----
app.post('/api/register', (req, res) => {
  const name = clean(req.body.name), email = clean(req.body.email).toLowerCase(), pw = req.body.password || '';
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) return fail(res, 400, 'Enter a valid name and email.');
  if (pw.length < 6) return fail(res, 400, 'Password must be at least 6 characters.');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return fail(res, 409, 'Email already registered.');
  const id = db.prepare('INSERT INTO users (name,email,password) VALUES (?,?,?)').run(name, email, bcrypt.hashSync(pw, 10)).lastInsertRowid;
  const user = { id, name, email, role: 'student' };
  res.json({ token: sign(user), user });
});
app.post('/api/login', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(clean(req.body.email).toLowerCase());
  if (!u || !bcrypt.compareSync(req.body.password || '', u.password)) return fail(res, 401, 'Invalid email or password.');
  res.json({ token: sign(u), user: { id: u.id, name: u.name, email: u.email, role: u.role } });
});
app.get('/api/me', auth, (req, res) => res.json({ user: req.user }));
app.get('/api/categories', (req, res) => res.json(CATEGORIES));

// ---- Items ----
app.get('/api/items', (req, res) => {
  const { q = '', type = '', category = '', status = 'open' } = req.query;
  let sql = 'SELECT i.*, u.name AS poster FROM items i JOIN users u ON u.id=i.user_id WHERE 1=1';
  const p = [];
  if (q.trim()) { sql += ' AND (i.title LIKE ? OR i.description LIKE ? OR i.location LIKE ?)'; const l = `%${q.trim()}%`; p.push(l, l, l); }
  if (['lost', 'found'].includes(type)) { sql += ' AND i.type=?'; p.push(type); }
  if (category) { sql += ' AND i.category=?'; p.push(category); }
  if (['open', 'returned'].includes(status)) { sql += ' AND i.status=?'; p.push(status); }
  const rows = db.prepare(sql + ' ORDER BY i.created_at DESC LIMIT 100').all(...p);
  rows.forEach(r => delete r.contact); // contact only on detail page for logged-in users
  res.json(rows);
});

app.get('/api/items/:id', optionalAuth, (req, res) => {
  const it = db.prepare('SELECT i.*, u.name AS poster FROM items i JOIN users u ON u.id=i.user_id WHERE i.id=?').get(req.params.id);
  if (!it) return fail(res, 404, 'Item not found.');
  const isOwner = !!req.user && (req.user.id === it.user_id || req.user.role === 'admin');
  if (!req.user) delete it.contact;
  const out = { item: it, isOwner, myClaim: null, claims: [] };
  if (isOwner) out.claims = db.prepare('SELECT c.*, u.name, u.email FROM claims c JOIN users u ON u.id=c.user_id WHERE c.item_id=? ORDER BY c.created_at DESC').all(it.id);
  else if (req.user) out.myClaim = db.prepare('SELECT * FROM claims WHERE item_id=? AND user_id=?').get(it.id, req.user.id) || null;
  res.json(out);
});

app.post('/api/items', auth, upload.single('image'), (req, res) => {
  const b = req.body, f = { type: clean(b.type), title: clean(b.title), description: clean(b.description), category: clean(b.category), location: clean(b.location), item_date: clean(b.item_date), contact: clean(b.contact) };
  const bad = msg => { if (req.file) removeImage(req.file.filename); return fail(res, 400, msg); };
  if (Object.values(f).some(v => !v)) return bad('Please fill in all required fields.');
  if (!['lost', 'found'].includes(f.type)) return bad('Invalid type.');
  if (!CATEGORIES.includes(f.category)) return bad('Invalid category.');
  if (isNaN(Date.parse(f.item_date)) || f.item_date > new Date().toISOString().slice(0, 10)) return bad('Date cannot be in the future.');
  const id = db.prepare('INSERT INTO items (user_id,type,title,description,category,location,item_date,image,contact) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(req.user.id, f.type, f.title, f.description, f.category, f.location, f.item_date, req.file ? req.file.filename : null, f.contact).lastInsertRowid;
  res.json({ id });
});

function ownedItem(req, res) {
  const it = db.prepare('SELECT * FROM items WHERE id=?').get(req.params.id);
  if (!it) { fail(res, 404, 'Item not found.'); return null; }
  if (it.user_id !== req.user.id && req.user.role !== 'admin') { fail(res, 403, 'Not allowed.'); return null; }
  return it;
}
app.post('/api/items/:id/toggle', auth, (req, res) => {
  const it = ownedItem(req, res); if (!it) return;
  db.prepare("UPDATE items SET status=CASE status WHEN 'open' THEN 'returned' ELSE 'open' END WHERE id=?").run(it.id);
  res.json({ ok: true });
});
app.delete('/api/items/:id', auth, (req, res) => {
  const it = ownedItem(req, res); if (!it) return;
  db.prepare('DELETE FROM items WHERE id=?').run(it.id); removeImage(it.image);
  res.json({ ok: true });
});

// ---- Claims ----
app.post('/api/items/:id/claims', auth, (req, res) => {
  const it = db.prepare('SELECT * FROM items WHERE id=?').get(req.params.id);
  if (!it) return fail(res, 404, 'Item not found.');
  if (it.status !== 'open') return fail(res, 400, 'This item is no longer open.');
  if (it.user_id === req.user.id) return fail(res, 400, 'You cannot send a request on your own item.');
  const msg = clean(req.body.message);
  if (!msg) return fail(res, 400, 'Please describe how you can prove this.');
  if (db.prepare('SELECT 1 FROM claims WHERE item_id=? AND user_id=?').get(it.id, req.user.id)) return fail(res, 409, 'You already sent a request for this item.');
  db.prepare('INSERT INTO claims (item_id,user_id,message) VALUES (?,?,?)').run(it.id, req.user.id, msg);
  res.json({ ok: true });
});
app.post('/api/claims/:id/:action(approve|reject)', auth, (req, res) => {
  const c = db.prepare('SELECT c.*, i.user_id AS owner FROM claims c JOIN items i ON i.id=c.item_id WHERE c.id=?').get(req.params.id);
  if (!c) return fail(res, 404, 'Request not found.');
  if (c.owner !== req.user.id && req.user.role !== 'admin') return fail(res, 403, 'Not allowed.');
  const status = req.params.action === 'approve' ? 'approved' : 'rejected';
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE claims SET status=? WHERE id=?').run(status, c.id);
    if (status === 'approved') db.prepare("UPDATE items SET status='returned' WHERE id=?").run(c.item_id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  res.json({ ok: true });
});

// ---- My activity ----
app.get('/api/my', auth, (req, res) => {
  const items = db.prepare(`SELECT i.*, (SELECT COUNT(*) FROM claims c WHERE c.item_id=i.id AND c.status='pending') AS pending
    FROM items i WHERE i.user_id=? ORDER BY i.created_at DESC`).all(req.user.id);
  const claims = db.prepare('SELECT c.*, i.title FROM claims c JOIN items i ON i.id=c.item_id WHERE c.user_id=? ORDER BY c.created_at DESC').all(req.user.id);
  res.json({ items, claims });
});

// ---- Admin ----
const admin = express.Router();
admin.use(auth, adminOnly);
admin.get('/stats', (req, res) => res.json(db.prepare(`SELECT (SELECT COUNT(*) FROM items) items,
  (SELECT COUNT(*) FROM items WHERE status='returned') returned, (SELECT COUNT(*) FROM users) users,
  (SELECT COUNT(*) FROM claims WHERE status='pending') pending`).get()));
admin.get('/items', (req, res) => res.json(db.prepare('SELECT i.*, u.name AS poster FROM items i JOIN users u ON u.id=i.user_id ORDER BY i.created_at DESC').all()));
admin.get('/users', (req, res) => res.json(db.prepare('SELECT id,name,email,role,created_at FROM users ORDER BY created_at DESC').all()));
admin.get('/claims', (req, res) => res.json(db.prepare('SELECT c.*, u.name, i.title FROM claims c JOIN users u ON u.id=c.user_id JOIN items i ON i.id=c.item_id ORDER BY c.created_at DESC').all()));
admin.post('/users/:id/role', (req, res) => {
  if (+req.params.id === req.user.id) return fail(res, 400, 'You cannot change your own role.');
  db.prepare("UPDATE users SET role=CASE role WHEN 'admin' THEN 'student' ELSE 'admin' END WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});
admin.delete('/users/:id', (req, res) => {
  if (+req.params.id === req.user.id) return fail(res, 400, 'You cannot delete yourself.');
  db.prepare('SELECT image FROM items WHERE user_id=?').all(req.params.id).forEach(r => removeImage(r.image));
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});
app.use('/api/admin', admin);

app.use('/api', (req, res) => fail(res, 404, 'Not found.'));
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return fail(res, 400, err.code === 'LIMIT_FILE_SIZE' ? 'Image must be under 2 MB.' : err.message);
  if (err.message && /images are allowed/.test(err.message)) return fail(res, 400, err.message);
  console.error(err); fail(res, 500, 'Server error.');
});

app.listen(PORT, () => console.log(`Campus Lost & Found running at http://localhost:${PORT}`));
