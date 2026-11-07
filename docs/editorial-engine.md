# Motore editoriale

## Dalla fonte allo script

```
RSS ─ normalizzazione ─ deduplica ─ clustering ─ ranking ─ candidato
                                                              │ scelta in Studio
                                                              ▼
       pacchetto di evidenze ─ bozza IA ─ QC deterministico ─ verifica semantica ─ revisione umana
```

### Raccolta

`config/sources.json` elenca le fonti. Per ogni articolo restano URL, editore, autore,
data di pubblicazione e, se esplicita nel testo, data dell'evento. Gli elementi senza data,
più vecchi di 72 ore o datati nel futuro vengono scartati: una notizia che non si può
collocare nel tempo non si può verificare.

Il testo delle fonti è considerato ostile: i tag e i caratteri invisibili vengono rimossi,
gli URL arrivano solo dalla nostra lista, i redirect non possono uscire dal sito.

### Eventi

Il clustering confronta i vettori TF-IDF con stemming leggero, entro 48 ore. Per unire due
articoli servono similarità sufficiente e almeno due termini distintivi in comune. Gli
embedding sono opzionali e si sommano al punteggio lessicale.

Un articolo su un evento già coperto apre un aggiornamento collegato, non riapre l'originale.

Testate dello stesso `group_key` contano come una sola fonte.

### Ranking

| Componente | Peso massimo |
| --- | --- |
| Fonti indipendenti | 35 |
| Affidabilità | 20 |
| Recenza (dimezza ogni 8 ore) | 20 |
| Categoria | 20 |
| Territorio | 5 |

Le visualizzazioni non sono un input. Sono candidabili gli eventi con almeno 2 gruppi
indipendenti o con una fonte istituzionale. Lotterie, oroscopi e gallerie sono esclusi.

### Script

Il modello riceve solo il pacchetto di evidenze. Ogni frase dichiara il tipo (`fact`,
`interpretation`, `connective`) e, se non è di raccordo, cita un'evidenza con una frase
copiata alla lettera. Crediti e URL nella descrizione YouTube sono costruiti dal codice.

### Quality control

Sono controlli in codice: stesso input, stesso esito.

| Controllo | Esito se fallisce |
| --- | --- |
| Fonte inesistente o assente | Blocco |
| Citazione non presente nella fonte | Blocco |
| Numero non presente nelle fonti citate | Blocco |
| Nome proprio non presente nelle fonti citate | Blocco |
| Fatti travestiti da frasi di raccordo | Blocco |
| Interpretazione senza attribuzione | Blocco |
| "Oggi" o "ieri" incoerenti con le date (fuso Europe/Rome) | Blocco |
| Fonti indipendenti citate sotto la soglia del formato | Blocco |
| Tutte le fonti oltre 48 ore | Blocco |
| Titolo sensazionalistico | Blocco |
| Durata molto fuori range | Blocco |
| Ripetizioni, linguaggio enfatico, durata fuori range, temi delicati | Revisione |
| Elenco di dichiarazioni, troppe citazioni dirette, frasi riempitive | Revisione |

Ogni bozza viene salvata come versione, con i motivi del QC. Una bozza bloccata ha un solo nuovo
tentativo con l'elenco dei problemi. Se fallisce ancora lo script resta bloccato: è visibile e non
può essere approvato, nemmeno da un admin.

La verifica semantica, con un secondo modello, cerca ciò che il confronto testuale non vede.
Può solo aggiungere rilievi. Se non è disponibile lo script va in revisione. `pass` significa
"pronto per un umano", mai "pubblicabile".

## Limiti noti

- **Evidenze scarse.** Molti feed offrono circa 100 caratteri per articolo. Il QC è quindi
  severo sulla brevità: sugli eventi con poche fonti è probabile uno script bloccato o corto.
  Se il collaudo lo confermerà, la soluzione è leggere il testo completo degli articoli, con
  una verifica dei termini d'uso di ogni testata.
- **Nomi comuni.** Il controllo sui nomi propri si basa sulle maiuscole: non vede i nomi
  scritti in minuscolo né le parafrasi. Per queste c'è la verifica semantica.
- **Raggruppamenti imprecisi.** Storie affini possono finire insieme (pensioni dei militari e
  manovra) e una storia può dividersi in due eventi (nomina all'Anac). Il revisore vede tutte
  le fonti del cluster, ma due candidati possono descrivere lo stesso fatto.
- **Dipendenza dalle agenzie.** Testate diverse che riprendono la stessa agenzia contano come
  indipendenti: `group_key` non può accorgersene.
- **Categorie.** Sono parole chiave: utili per il ranking, non precise (la Nazionale contro la
  Francia risulta "esteri").
- **Affidabilità delle fonti.** I valori in `config/sources.json` sono una proposta iniziale:
  sono una scelta editoriale, non una misura.

## Risultati su dati reali (5 novembre 2026)

Esecuzione di `npm run job:ingest -- --dry-run`, 12 fonti, nessuna scrittura:

| Misura | Valore |
| --- | --- |
| Articoli validi | 363 |
| Eventi | 241 |
| Eventi con più fonti | 41 |
| Candidati | 49 |

Corriere è escluso perché il feed è fermo a maggio 2024. Il Post risponde 403 ai bot.

## Scegliere i modelli

```bash
BENCHMARK_ROUTES=anthropic:claude-haiku-5-5,anthropic:claude-sonnet-5-5,openai:gpt-6-luna,gemini:gemini-2.5-flash-lite npm run benchmark
```

Il comando **costa**: chiama ogni modello una volta. Stampa esito del QC, blocchi, latenza,
costo stimato e il testo, da leggere per giudicare l'italiano.

Attenzione: sul tier gratuito di Gemini i dati possono essere usati per migliorare i prodotti.
