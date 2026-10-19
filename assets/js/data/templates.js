/* Sequence Studio — hazır şablonlar (TR / EN) */
window.SeqTemplates = [
  {
    id: 'blank',
    tr: {
      name: 'Boş diyagram',
      desc: 'Sıfırdan başla',
      code: `sequenceDiagram
    actor User as Kullanıcı
    participant API as API Gateway

    User->>API: İstek
    API-->>User: Yanıt
`,
    },
    en: {
      name: 'Blank diagram',
      desc: 'Start from scratch',
      code: `sequenceDiagram
    actor User
    participant API as API Gateway

    User->>API: Request
    API-->>User: Response
`,
    },
  },
  {
    id: 'login',
    tr: {
      name: 'Kimlik doğrulama (OAuth2)',
      desc: 'alt/else, activation, not',
      code: `sequenceDiagram
    title OAuth2 Authorization Code Akışı
    autonumber
    actor U as Kullanıcı
    participant B@{ "type": "boundary" } as Tarayıcı
    participant AS@{ "type": "control" } as Auth Server
    participant API as Resource API
    participant DB@{ "type": "database" } as User DB

    U->>B: Uygulamayı açar
    B->>AS: /authorize?client_id=...
    AS->>DB: Kullanıcıyı sorgula
    DB-->>AS: Kullanıcı kaydı
    alt Kimlik bilgileri geçerli
        AS-->>B: 302 redirect + code
        B->>AS: POST /token (code)
        AS-->>B: access_token + refresh_token
        B->>API: GET /me (Bearer token)
        API-->>B: 200 Profil
        Note over B,API: Token 15 dk geçerli
    else Geçersiz kimlik
        AS--xB: 401 Unauthorized
        B-->>U: Hata mesajı göster
    end
`,
    },
    en: {
      name: 'Authentication (OAuth2)',
      desc: 'alt/else, activation, note',
      code: `sequenceDiagram
    title OAuth2 Authorization Code Flow
    autonumber
    actor U as User
    participant B@{ "type": "boundary" } as Browser
    participant AS@{ "type": "control" } as Auth Server
    participant API as Resource API
    participant DB@{ "type": "database" } as User DB

    U->>B: Opens the app
    B->>AS: /authorize?client_id=...
    AS->>DB: Look up user
    DB-->>AS: User record
    alt Credentials valid
        AS-->>B: 302 redirect + code
        B->>AS: POST /token (code)
        AS-->>B: access_token + refresh_token
        B->>API: GET /me (Bearer token)
        API-->>B: 200 Profile
        Note over B,API: Token valid for 15 min
    else Invalid credentials
        AS--xB: 401 Unauthorized
        B-->>U: Show error message
    end
`,
    },
  },
  {
    id: 'checkout',
    tr: {
      name: 'E-ticaret sipariş akışı',
      desc: 'box, par, critical, loop, break',
      code: `sequenceDiagram
    title Sipariş Oluşturma
    actor C as Müşteri
    box rgba(108, 124, 255, 0.10) Frontend
        participant WEB as Web App
    end
    box rgba(47, 191, 127, 0.12) Backend
        participant ORD@{ "type": "control" } as Order Service
        participant PAY as Payment Service
        participant INV as Inventory Service
        participant MQ@{ "type": "queue" } as Event Bus
    end
    participant DB@{ "type": "database" } as Orders DB

    C->>WEB: Sepeti onayla
    WEB->>ORD: POST /orders
    critical Stok rezervasyonu
        ORD->>INV: reserve(items)
        INV-->>ORD: reserved
    option Stok yetersiz
        INV-->>ORD: out_of_stock
        ORD-->>WEB: 409 Conflict
    end
    loop En fazla 3 deneme
        ORD->>PAY: charge(amount)
        PAY-->>ORD: sonuç
    end
    break Ödeme reddedildi
        ORD-)INV: release(items)
        ORD-->>WEB: 402 Payment Required
    end
    par Kalıcılaştır
        ORD->>DB: INSERT order
    and Olay yayınla
        ORD-)MQ: OrderCreated
    end
    ORD-->>WEB: 201 Created
    WEB-->>C: Sipariş onayı
    Note right of C: E-posta ile bildirim gönderilir
`,
    },
    en: {
      name: 'E-commerce checkout',
      desc: 'box, par, critical, loop, break',
      code: `sequenceDiagram
    title Order Creation
    actor C as Customer
    box rgba(108, 124, 255, 0.10) Frontend
        participant WEB as Web App
    end
    box rgba(47, 191, 127, 0.12) Backend
        participant ORD@{ "type": "control" } as Order Service
        participant PAY as Payment Service
        participant INV as Inventory Service
        participant MQ@{ "type": "queue" } as Event Bus
    end
    participant DB@{ "type": "database" } as Orders DB

    C->>WEB: Confirm cart
    WEB->>ORD: POST /orders
    critical Reserve stock
        ORD->>INV: reserve(items)
        INV-->>ORD: reserved
    option Out of stock
        INV-->>ORD: out_of_stock
        ORD-->>WEB: 409 Conflict
    end
    loop Up to 3 attempts
        ORD->>PAY: charge(amount)
        PAY-->>ORD: result
    end
    break Payment declined
        ORD-)INV: release(items)
        ORD-->>WEB: 402 Payment Required
    end
    par Persist
        ORD->>DB: INSERT order
    and Publish event
        ORD-)MQ: OrderCreated
    end
    ORD-->>WEB: 201 Created
    WEB-->>C: Order confirmation
    Note right of C: Notification sent by e-mail
`,
    },
  },
  {
    id: 'events',
    tr: {
      name: 'Event-driven mikroservis',
      desc: 'async mesajlar, opt, rect',
      code: `sequenceDiagram
    title Asenkron Bildirim Akışı
    participant SVC as Order Service
    participant K@{ "type": "queue" } as Kafka
    participant N@{ "type": "collections" } as Notification Workers
    participant E as E-posta Sağlayıcı
    participant S@{ "type": "entity" } as Audit Log

    SVC-)K: publish(OrderShipped)
    rect rgba(124, 140, 255, 0.12)
        K-)N: consume(OrderShipped)
        activate N
        N->>E: sendMail(template)
        E-->>N: 202 Accepted
        opt Müşteri SMS tercih ettiyse
            N->>E: sendSms()
        end
        deactivate N
    end
    N-)S: append(event)
    Note over K,N: At-least-once teslim garantisi
`,
    },
    en: {
      name: 'Event-driven microservices',
      desc: 'async messages, opt, rect',
      code: `sequenceDiagram
    title Async Notification Flow
    participant SVC as Order Service
    participant K@{ "type": "queue" } as Kafka
    participant N@{ "type": "collections" } as Notification Workers
    participant E as Email Provider
    participant S@{ "type": "entity" } as Audit Log

    SVC-)K: publish(OrderShipped)
    rect rgba(124, 140, 255, 0.12)
        K-)N: consume(OrderShipped)
        activate N
        N->>E: sendMail(template)
        E-->>N: 202 Accepted
        opt Customer prefers SMS
            N->>E: sendSms()
        end
        deactivate N
    end
    N-)S: append(event)
    Note over K,N: At-least-once delivery guarantee
`,
    },
  },
];
