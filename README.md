# Go-AI Chatbot Demo

Chatbot tư vấn pháp luật Việt Nam dành cho doanh nghiệp sản xuất/kinh doanh trong khu công nghiệp (KCN).  
Toàn bộ chạy trên **Cloudflare miễn phí** (Workers + Pages + D1 + Vectorize + Workers AI + R2).

## Tính năng
- Site **User**: Đăng ký / Đăng nhập → vào ngay giao diện chat
- Site **Admin**: Upload văn bản luật → tự động chia chunk + tạo embedding vào Knowledge Base
- RAG: AI trả lời dựa trên KB thật (Nghị định 35/2022, VBHN 9716/2024…)
- PWA: Có thể cài đặt như app lên máy tính/điện thoại
- 100% free tier

---

## Bước 1: Chuẩn bị tài khoản (bạn làm)

1. Đăng ký Cloudflare: https://dash.cloudflare.com/sign-up
2. Cài Node.js LTS: https://nodejs.org
3. Cài Wrangler:
   ```bash
   npm install -g wrangler
   wrangler login
   ```

---

## Bước 2: Tạo tài nguyên Cloudflare (bạn chạy lệnh)

Mở Terminal trong thư mục dự án này và chạy lần lượt:

```bash
# 1. Tạo D1 database
wrangler d1 create go-ai-db
# Copy database_id trả về → dán vào wrangler.toml (dòng database_id)

# 2. Tạo Vectorize index
wrangler vectorize create go-ai-kb --dimensions=768 --metric=cosine

# 3. Tạo R2 bucket
wrangler r2 bucket create go-ai-kb-files

# 4. Chạy schema database
wrangler d1 execute go-ai-db --file=./schema.sql
```

Mở file `wrangler.toml` và thay `REPLACE_WITH_YOUR_D1_ID` bằng ID thật.

---

## Bước 3: Deploy Backend (Worker)

```bash
wrangler deploy
```

Sau khi deploy xong, bạn sẽ nhận được URL dạng:
`https://go-ai-chatbot.<subdomain>.workers.dev`

**Ghi nhớ URL này.**

---

## Bước 4: Sửa Frontend cho đúng URL

Mở 2 file:
- `public/index.html`
- `public/admin.html`

Tìm dòng:
```js
const API_BASE = "https://go-ai-chatbot.<your-subdomain>.workers.dev";
```
Thay bằng URL thật bạn vừa nhận được.

---

## Bước 5: Deploy Frontend (Pages)

Cách nhanh nhất (Direct Upload):

```bash
# Cài thêm nếu cần
npx wrangler pages project create go-ai-frontend

# Deploy thư mục public
npx wrangler pages deploy public --project-name=go-ai-frontend
```

Hoặc kết nối GitHub (khuyến nghị lâu dài):
1. Tạo repo mới trên GitHub của bạn
2. Push toàn bộ code lên
3. Vào Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git → chọn repo → Root directory để trống, Build output directory = `public`

Sau khi deploy, bạn có URL dạng: `https://go-ai-frontend.pages.dev`

- User site: `https://go-ai-frontend.pages.dev`
- Admin site: `https://go-ai-frontend.pages.dev/admin.html`

---

## Bước 6: Tạo icon PWA (tùy chọn nhưng nên làm)

Tạo 2 ảnh:
- `public/icon-192.png` (192×192)
- `public/icon-512.png` (512×512)

Bạn có thể dùng Canva hoặc AI tạo logo đơn giản chữ “Go-AI”.

---

## Bước 7: Thêm dữ liệu Knowledge Base

1. Vào trang Admin: `https://...pages.dev/admin.html`
2. Đăng nhập:
   - Email: `admin@go-ai.local`
   - Password: `admin123`
3. Dán nội dung nghị định/luật (text thuần) → bấm Upload & Index

**Nguồn văn bản nên dùng:**
- Nghị định 35/2022/NĐ-CP
- Văn bản hợp nhất 9716/VBHN-BKHĐT 2024
- Các nghị định liên quan về ưu đãi, môi trường, lao động trong KCN

---

## Tài khoản mặc định
| Vai trò | Email                  | Mật khẩu  |
|---------|------------------------|-----------|
| Admin   | admin@go-ai.local      | admin123  |

**Nhớ đổi mật khẩu admin sau khi demo xong!**

---

## Cấu trúc thư mục
```
go-ai-chatbot/
├── wrangler.toml          # Cấu hình Cloudflare
├── schema.sql             # Database schema
├── src/
│   └── index.js           # Backend Worker (Auth + Chat + RAG)
├── public/
│   ├── index.html         # Site User (login + chat)
│   ├── admin.html         # Site Admin
│   ├── manifest.json      # PWA
│   ├── icon-192.png       # (bạn thêm)
│   └── icon-512.png       # (bạn thêm)
└── README.md
```

---

## Lưu ý quan trọng
- Free tier Workers AI: 10.000 Neurons/ngày (đủ demo).
- Vectorize free: đủ cho hàng chục nghìn đoạn văn bản.
- Token auth hiện tại rất đơn giản (chỉ dùng demo). Production nên dùng JWT + refresh token.
- Model hiện dùng: `@cf/baai/bge-base-en-v1.5` (embedding) + `@cf/meta/llama-3.1-8b-instruct` (chat). Có thể đổi sang model mạnh hơn nếu quota cho phép.

Chúc bạn demo thành công!  
Nếu gặp lỗi ở bước nào, gửi mình log hoặc ảnh màn hình để hỗ trợ tiếp.
"# go-ai-chatbot" 
