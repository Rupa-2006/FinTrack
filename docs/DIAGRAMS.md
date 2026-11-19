# FinTrack diagrams

Use cases and data flow. The diagrams are written in Mermaid, which GitHub and most Markdown
viewers draw directly. The ER diagram is in [DATABASE_DESIGN.md](DATABASE_DESIGN.md), and the
component diagram and a request sequence are in [ARCHITECTURE.md](ARCHITECTURE.md).

Notation in the data-flow diagrams:

| Shape | Meaning |
|---|---|
| Rectangle | External entity |
| Circle | Process |
| Cylinder | Data store |
| Labelled arrow | Data flow |
| Dashed box | Trust boundary |

## 1. Use-case diagram

Three human actors and two external systems. An administrator is also a user. The admin
use cases deliberately exclude reading anyone's financial records.

```mermaid
flowchart LR
    V["Visitor"]
    U["Registered user"]
    A["Administrator"]
    FX["Exchange-rate API<br/>(Frankfurter)"]
    MAIL["Email provider<br/>(SMTP)"]

    subgraph FT["FinTrack"]
        direction TB
        subgraph ACC["Account"]
            UC1([Register])
            UC2([Sign in / sign out])
            UC3([Reset forgotten password])
            UC4([Manage profile and password])
            UC5([Deactivate account])
        end
        subgraph MON["Money"]
            UC6([Record, edit, delete transactions])
            UC7([Search, filter, export CSV])
            UC8([Set monthly budgets and savings targets])
            UC9([Manage savings goals and contributions])
            UC10([Convert currencies, change main currency])
        end
        subgraph INS["Insights"]
            UC11([View dashboard])
            UC12([View reports by day, week, month, year])
            UC13([Ask the AI assistant])
            UC14([Review unusual expenses and estimates])
            UC15([Read notifications])
        end
        subgraph SEC["Security"]
            UC16([Review sessions and end them])
            UC17([Review sign-in history and own audit trail])
        end
        subgraph ADM["Administration"]
            UC18([View usage statistics])
            UC19([Suspend, reactivate, unlock accounts])
            UC20([Grant or remove the admin role])
            UC21([Monitor security events])
            UC22([Review and verify the audit log])
        end
    end

    V --> UC1
    V --> UC2
    V --> UC3
    U --> UC2
    U --> UC4
    U --> UC5
    U --> UC6
    U --> UC7
    U --> UC8
    U --> UC9
    U --> UC10
    U --> UC11
    U --> UC12
    U --> UC13
    U --> UC14
    U --> UC15
    U --> UC16
    U --> UC17
    A -. "is a" .-> U
    A --> UC18
    A --> UC19
    A --> UC20
    A --> UC21
    A --> UC22
    UC10 --- FX
    UC6 --- FX
    UC3 --- MAIL
```

| Use case | Includes / extends |
|---|---|
| Record a transaction | includes *convert to the main currency* (rate looked up or fetched); extends to *budget alert*, *unusual-spending alert* and *transaction confirmation* |
| Sign in | includes *record security event*; extends to *lockout after 5 failures* and *new-device notice* |
| Reset forgotten password | includes *send email*; ends every session on completion |
| Ask the AI assistant | includes *collect the user's own records* and *signed call to the AI service* |
| Any change | includes *append to the audit trail* (same database transaction) |

## 2. Data-flow diagram, level 0 (context)

```mermaid
flowchart LR
    U["User"]
    A["Administrator"]
    FX["Exchange-rate API"]
    M["Email provider"]
    P(("0<br/>FinTrack"))

    U -- "credentials, transactions, budgets,<br/>goals, questions" --> P
    P -- "dashboards, reports, CSV, answers,<br/>notifications, session list" --> U
    A -- "account actions, role changes,<br/>chain verification" --> P
    P -- "counts, account metadata,<br/>security events, audit rows" --> A
    P -- "currency codes, date" --> FX
    FX -- "reference rates" --> P
    P -- "reset link, recipient address" --> M
```

Nothing financial leaves the system: the rates API receives only currency codes and a date,
and the email provider receives an address and a reset link.

## 3. Data-flow diagram, level 1

```mermaid
flowchart TB
    U["User"]
    A["Administrator"]
    FX["Exchange-rate API"]
    M["Email provider"]

    subgraph TB1["Trust boundary: API server"]
        P1(("1<br/>Authenticate and<br/>manage sessions"))
        P2(("2<br/>Record<br/>transactions"))
        P3(("3<br/>Budgets and<br/>goals"))
        P4(("4<br/>Convert<br/>currencies"))
        P5(("5<br/>Analytics and<br/>reports"))
        P6(("6<br/>Assistant<br/>gateway"))
        P7(("7<br/>Notify"))
        P8(("8<br/>Audit and security<br/>logging"))
        P9(("9<br/>Administer"))
    end

    subgraph TB2["Trust boundary: AI service (no database access)"]
        P10(("10<br/>Analyse records"))
    end

    D1[("D1 users, roles,<br/>user_roles")]
    D2[("D2 user_sessions,<br/>refresh_tokens,<br/>password_reset_tokens")]
    D3[("D3 categories,<br/>transactions")]
    D4[("D4 budgets, savings_goals,<br/>goal_contributions")]
    D5[("D5 currencies,<br/>exchange_rates")]
    D6[("D6 notifications")]
    D7[("D7 security_events")]
    D8[("D8 audit_logs,<br/>audit_chain_head")]

    U -- credentials --> P1
    P1 -- "access token, refresh cookie" --> U
    P1 <--> D1
    P1 <--> D2
    P1 -- "reset link" --> M
    P1 -- "sign-in events" --> P8

    U -- "transaction details" --> P2
    P2 -- "amount, currency, date" --> P4
    P4 <--> D5
    P4 -- "codes, date" --> FX
    FX -- rates --> P4
    P4 -- "rate, converted amount" --> P2
    P2 -- "row (notes encrypted)" --> D3
    P2 -- "confirmation, alerts" --> P7

    U -- "budgets, goals, contributions" --> P3
    P3 <--> D4
    D3 -- "spent per month" --> P3
    P3 -- "threshold crossed" --> P7

    D3 -- "user's rows only" --> P5
    D4 -- "user's rows only" --> P5
    P5 -- "dashboard, report, CSV" --> U

    U -- question --> P6
    D3 -- "user's rows, no notes" --> P6
    D4 -- "user's budgets and goals" --> P6
    P6 -- "signed request" --> P10
    P10 -- "insights, answer" --> P6
    P6 -- "answer, insights" --> U

    P7 --> D6
    D6 -- notifications --> U

    P2 -- "who, what, which record" --> P8
    P3 -- "who, what, which record" --> P8
    P9 -- "who, what, which record" --> P8
    P8 -- "hash-chained row" --> D8
    P8 -- events --> D7
    P8 -- "security notices" --> P7

    A -- "account actions" --> P9
    P9 <--> D1
    P9 -- "end sessions" --> D2
    D7 -- "all events" --> P9
    D8 -- "audit rows, chain check" --> P9
    D3 -. "COUNT(*) only" .-> P9
    P9 -- "metadata, counts, events" --> A
```

What the level-1 diagram shows about the security design:

- **The AI service is a separate trust zone.** It receives only what process 6 sends: the
  signed-in user's transactions without notes, plus their budgets and goals. It reads no data
  store.
- **Administrators never read money rows.** Process 9 reads users, sessions, security events
  and audit rows. From the money tables it only receives counts.
- **Every change reaches the audit log.** Processes 2, 3 and 9, and the account changes in
  process 1, all feed process 8 inside the same database transaction. The audit rows hold
  field names and ids, never amounts or text.

## 4. Data-flow diagram, level 2: asking the AI assistant

```mermaid
flowchart LR
    U["User"]
    subgraph API["API server"]
        Q1(("6.1<br/>Authenticate<br/>and rate-limit"))
        Q2(("6.2<br/>Collect the user's<br/>records (13 months)"))
        Q3(("6.3<br/>Sign request<br/>HMAC-SHA256"))
    end
    subgraph AI["AI service"]
        R1(("10.1<br/>Verify signature,<br/>age, replay"))
        R2(("10.2<br/>Validate schema<br/>(unknown fields refused)"))
        R3(("10.3<br/>Answer or analyse<br/>(rules, z-score,<br/>Isolation Forest)"))
    end
    D3[("D3 transactions")]
    D4[("D4 budgets, goals")]
    D2[("D2 user_sessions")]

    U -- "question + access token" --> Q1
    D2 -- "session live?" --> Q1
    Q1 -- "user id (from token only)" --> Q2
    D3 -- "date, type, amount in main currency,<br/>category, description" --> Q2
    D4 -- "this month's budgets, goals" --> Q2
    Q2 -- "payload" --> Q3
    Q3 -- "timestamp, request id,<br/>signature, body" --> R1
    R1 -- "verified body" --> R2
    R2 -- "typed records" --> R3
    R3 -- "answer, facts, disclaimer" --> Q1
    Q1 -- "answer (not stored)" --> U
```

## 5. Data-flow diagram, level 2: sign-in and session refresh

```mermaid
sequenceDiagram
    participant B as Browser
    participant A as API
    participant D as MySQL
    B->>A: POST /auth/login (email, password, X-Requested-With)
    A->>D: user by email; failed-attempt count
    A->>A: bcrypt compare (dummy hash for unknown emails)
    alt wrong password
        A->>D: count failure, security event (lock after 5)
        A-->>B: 401 (same message for unknown email)
    else correct
        A->>D: new user_sessions row, refresh-token hash, audit row
        A-->>B: 200 access token (15 min, kept in memory) + httpOnly cookie
    end
    Note over B,A: 15 minutes later, or after a reload
    B->>A: POST /auth/refresh (cookie, allowed Origin, X-Requested-With)
    A->>D: find token by SHA-256 hash, lock row
    alt token already used
        A->>D: revoke the whole session, security event, notify user
        A-->>B: 401
    else valid
        A->>D: mark used, store the next token's hash
        A-->>B: new access token + rotated cookie
    end
```
