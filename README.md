# Campus Lost & Found (Node.js + Express + SQLite + Vanilla JS)

Students report lost/found items, search and filter, and send ownership/found requests. Item owners approve or reject requests; admins manage everything.

## Tech
- **Frontend:** HTML, CSS, vanilla JavaScript single-page app (hash routing) in `public/`
- **Backend:** Node.js + Express REST API in `server.js`
- **Database:** SQLite via node:sqlite (file `data/lostfound.db`, auto-created - no DB server needed)
- **Security:** bcrypt password hashing, JWT auth, prepared statements, upload type/size checks, HTML escaping

## Run
Requires Node.js 22.13+ (uses the built-in node:sqlite - no native compile) (https://nodejs.org).
```bash
cd campus-lost-found-node
npm install
npm start
```
Open http://localhost:3000

**Default admin:** `admin@campus.edu` / `admin123` - change it (register a new user, promote to admin, delete the default).

Optional env vars: `PORT`, `JWT_SECRET`.

## API summary
| Method | Route | Notes |
|---|---|---|
| POST | /api/register, /api/login | returns `{token,user}` |
| GET | /api/items?q&type&category&status | public search |
| GET | /api/items/:id | contact hidden when logged out |
| POST | /api/items | multipart, auth |
| POST | /api/items/:id/toggle, DELETE /api/items/:id | owner/admin |
| POST | /api/items/:id/claims | send request |
| POST | /api/claims/:id/approve \| reject | owner/admin |
| GET | /api/my | my items & requests |
| GET/POST/DELETE | /api/admin/... | stats, items, users, claims (admin) |

## Structure
```
server.js        API + DB + auth + uploads
public/          index.html, css/style.css, js/app.js, placeholder.svg
uploads/         uploaded photos
data/            SQLite DB + JWT secret (generated)
```
