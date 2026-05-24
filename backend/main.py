from fastapi import FastAPI, HTTPException, Request, status
from pydantic import BaseModel, RootModel
from typing import List, Dict, Any
import threading
import time
import os
import logging
from datetime import datetime
from contextlib import asynccontextmanager
import mysql.connector
from mysql.connector import Error
import requests

logging.basicConfig(level=logging.DEBUG)

# --- Fair Exchange Market Rates (Expanded to 8 UI Choices) ---
# Holds the active state of items matching your frontend label definitions.
DEFAULT_RATES: Dict[str, Dict[str, Any]] = {
    "tomatoes": {"display": "Tomatoes", "unit": "lb", "price": 3.90},
    "corn": {"display": "Corn", "unit": "ear", "price": 1.00},
    "eggs": {"display": "Farm Eggs", "unit": "dozen", "price": 4.50},
    "potatoes": {"display": "Potatoes", "unit": "lb", "price": 2.10},
    "honey": {"display": "Local Honey", "unit": "kg", "price": 17.50},
    "milk": {"display": "Fresh Milk", "unit": "gallon", "price": 5.60},
    "apples": {"display": "Apples", "unit": "lb", "price": 3.24},
    "berries": {"display": "Berries", "unit": "pint", "price": 5.50},
}

# --- BLS Artisan Configuration Registry ---
BLS_ARTISAN_REGISTRY = {
    "tomatoes": {
        "source_type": "LIVE_BLS",
        "series_id": "APU0000712311",      # Field Grown Tomatoes (per lb)
        "labor_premium": 1.50,
        "fallback_retail": 2.40
    },
    "corn": {
        "source_type": "STATIC_SEED",      # High seasonality item
        "labor_premium": 0.40,
        "fallback_retail": 0.60
    },
    "eggs": {
        "source_type": "LIVE_BLS",
        "series_id": "APU0000708111",      # Grade A Large Eggs (per dozen)
        "labor_premium": 2.25,
        "fallback_retail": 2.25
    },
    "potatoes": {
        "source_type": "LIVE_BLS",
        "series_id": "APU0000712112",      # White Potatoes (per lb)
        "labor_premium": 1.00,
        "fallback_retail": 1.10
    },
    "honey": {
        "source_type": "STATIC_SEED",      # Artisan local item
        "labor_premium": 10.00,
        "fallback_retail": 7.50
    },
    "milk": {
        "source_type": "LIVE_BLS",
        "series_id": "APU0000709112",      # Fresh Whole Milk (per gallon)
        "labor_premium": 1.50,
        "fallback_retail": 4.10
    },
    "apples": {
        "source_type": "LIVE_BLS",
        "series_id": "APU0000711111",      # Red Delicious Apples (per lb)
        "labor_premium": 1.25,
        "fallback_retail": 1.99
    },
    "berries": {
        "source_type": "STATIC_SEED",      # Wild/local micro-variations
        "labor_premium": 2.00,
        "fallback_retail": 3.50
    }
}


def get_artisan_value(item_key: str) -> float:
    """
    Looks up the item_key dynamically. Pulls live data if it's a BLS commodity, 
    or processes the static seed baseline directly if not. Automatically skips
    government shutdown hyphens ("-") in the live feed.
    """
    config = BLS_ARTISAN_REGISTRY.get(item_key.lower())
    if not config:
        logging.warning(f"'{item_key}' not found in backend registry.")
        return 0.00
        
    if config.get("source_type") == "LIVE_BLS":
        url = f"https://api.bls.gov/publicAPI/v2/timeseries/data/{config['series_id']}"
        try:
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            payload = response.json()
            
            if payload.get("status") == "REQUEST_SUCCEEDED":
                series_list = payload.get("Results", {}).get("series", [])
                if series_list and len(series_list[0].get("data", [])) > 0:
                    data_points = series_list[0]["data"]
                    
                    # Chronological fallback loop to handle missing data points or hyphens
                    for point in data_points:
                        value_str = point.get("value")
                        if value_str and value_str != "-":
                            retail_base = float(value_str)
                            return round(retail_base + config["labor_premium"], 2)
        except (requests.RequestException, KeyError, IndexError, ValueError) as e:
            logging.error(f"Error resolving BLS price for {item_key}: {e}")

    # Static route execution or API failure recovery block
    retail_base = config["fallback_retail"]
    return round(retail_base + config["labor_premium"], 2)


# ---- Modern Lifespan Handler ----
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Initialize Database Tables
    startup_db_setup()
    
    # 2. Fire Up Background Workers
    try:
        start_usda_rates_background_updater()
    except Exception as e:
        logging.error(f'Failed to start USDA background updater: {e}')
        
    yield  # Server serves requests here


app = FastAPI(title="Barter MVP API", lifespan=lifespan)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    body = await request.body()
    print(f"REQUEST BODY: {body}")
    response = await call_next(request)
    return response

# ---- MySQL config ----
MYSQL_HOST = os.getenv("MYSQL_HOST", "127.0.0.1")
MYSQL_PORT = int(os.getenv("MYSQL_PORT", "3306"))
MYSQL_USER = os.getenv("MYSQL_USER", "root")
MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "Jer.alex1023")
MYSQL_DATABASE = os.getenv("MYSQL_DATABASE", "barter_db")


def get_conn():
    return mysql.connector.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD,
        database=MYSQL_DATABASE,
    )


def startup_db_setup():
    try:
        conn = get_conn()
        cur = conn.cursor()
        create_table_sql = """
        CREATE TABLE IF NOT EXISTS trades (
            trade_id INT AUTO_INCREMENT PRIMARY KEY,
            sender_id VARCHAR(255) NOT NULL,
            receiver_id VARCHAR(255) NOT NULL,
            items_giving TEXT NOT NULL,
            items_receiving TEXT NOT NULL,
            meeting_name VARCHAR(255) NOT NULL,
            meeting_lat DOUBLE NOT NULL,
            meeting_lng DOUBLE NOT NULL,
            proposed_time DATETIME NOT NULL,
            status VARCHAR(50) DEFAULT 'pending',
            statusRec VARCHAR(50) DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
        cur.execute(create_table_sql)
        conn.commit()
        logging.info("Database initialized successfully; verified trades table exists.")
    except Error as e:
        logging.error(f"Error initializing database table: {e}")
    finally:
        if 'cur' in locals(): cur.close()
        if 'conn' in locals(): conn.close()


# ---- Pydantic schemas ----
class FarmerCreate(BaseModel):
    VENDOR_ID: str
    Name: str
    PRODUCE_GIVING: str = ""
    PRODUCE_WANTED: str = ""
    LATITUDE: float = 0.0
    LONGITUDE: float = 0.0


class FarmerUpdate(BaseModel):
    Name: str
    PRODUCE_GIVING: str
    PRODUCE_WANTED: str
    LATITUDE: float | None = None
    LONGITUDE: float | None = None


class FarmerOut(BaseModel):
    VENDOR_ID: str
    Name: str
    PRODUCE_GIVING: str
    PRODUCE_WANTED: str
    LATITUDE: float
    LONGITUDE: float


class LocationUpdate(BaseModel):
    latitude: float
    longitude: float


class TradeProposal(BaseModel):
    sender_id: str
    receiver_id: str
    Sender_note: str
    items_giving: str
    items_receiving: str
    meeting_name: str
    meeting_lat: float
    meeting_lng: float
    proposed_time: str  # ISO string or YYYY-MM-DD HH:MM:SS


class TradeStatusUpdate(BaseModel):
    status: str | None = None
    statusRec: str | None = None
    Sender_note: str | None = None
    Reciever_note: str | None = None


# ---- Fair Exchange Market Rates Endpoints ----

class RatesResponse(RootModel[Dict[str, Dict[str, Any]]]):
    pass


@app.get('/market/rates', response_model=Dict[str, Dict[str, Any]])
def get_market_rates():
    return DEFAULT_RATES


def update_rates_from_usda_daily():
    """Background loop method targeted to update global store values daily."""
    try:
        logging.info('Initializing automated calculation run across system targets...')
        for item_key in DEFAULT_RATES.keys():
            calculated_price = get_artisan_value(item_key)
            DEFAULT_RATES[item_key]["price"] = calculated_price
        logging.info('Platform system price sync run finished successfully.')
    except Exception as e:
        logging.error(f'Automated engine synchronization execution error encountered: {e}')


def start_usda_rates_background_updater():
    def worker():
        while True:
            update_rates_from_usda_daily()
            time.sleep(60 * 60 * 24)

    t = threading.Thread(target=worker, daemon=True)
    t.start()


# ---- Profile Endpoints ----

@app.post('/farmers', response_model=FarmerOut)
def register_farmer(farmer: FarmerCreate):
    try:
        conn = get_conn()
        cur = conn.cursor(dictionary=True)

        upsert_sql = (
            "INSERT INTO profiles "
            "(VENDOR_ID, Name, PRODUCE_GIVING, PRODUCE_WANTED, LATITUDE, LONGITUDE) "
            "VALUES (%s, %s, %s, %s, %s, %s) "
            "ON DUPLICATE KEY UPDATE "
            "Name=VALUES(Name), "
            "PRODUCE_GIVING=VALUES(PRODUCE_GIVING), "
            "PRODUCE_WANTED=VALUES(PRODUCE_WANTED), "
            "LATITUDE=VALUES(LATITUDE), "
            "LONGITUDE=VALUES(LONGITUDE)"
        )
        cur.execute(
            upsert_sql,
            (
                farmer.VENDOR_ID,
                farmer.Name,
                farmer.PRODUCE_GIVING,
                farmer.PRODUCE_WANTED,
                farmer.LATITUDE,
                farmer.LONGITUDE,
            ),
        )
        conn.commit()

        cur.execute("SELECT VENDOR_ID, Name, PRODUCE_GIVING, PRODUCE_WANTED, LATITUDE, LONGITUDE FROM profiles WHERE VENDOR_ID=%s", (farmer.VENDOR_ID,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=500, detail='Failed to load saved farmer')

        return FarmerOut(**row)
    except Error as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if 'cur' in locals(): cur.close()
        if 'conn' in locals(): conn.close()


@app.put('/farmers/{vendor_id}', response_model=FarmerOut)
def upsert_farmer(vendor_id: str, farmer: FarmerUpdate):
    try:
        conn = get_conn()
        cur = conn.cursor(dictionary=True)

        # Fetch existing coordinates so we can preserve them when client sends 0/0
        cur.execute(
            "SELECT LATITUDE, LONGITUDE FROM profiles WHERE VENDOR_ID=%s",
            (vendor_id,),
        )
        existing = cur.fetchone() or {}
        existing_lat = existing.get("LATITUDE", 0.0) or 0.0
        existing_lng = existing.get("LONGITUDE", 0.0) or 0.0

        incoming_lat = farmer.LATITUDE
        incoming_lng = farmer.LONGITUDE

        # Preserve if omitted or if it's 0 (the reset bug)
        next_lat = existing_lat if incoming_lat is None or incoming_lat == 0 else incoming_lat
        next_lng = existing_lng if incoming_lng is None or incoming_lng == 0 else incoming_lng

        upsert_sql = (
            "INSERT INTO profiles "
            "(VENDOR_ID, Name, PRODUCE_GIVING, PRODUCE_WANTED, LATITUDE, LONGITUDE) "
            "VALUES (%s, %s, %s, %s, %s, %s) "
            "ON DUPLICATE KEY UPDATE "
            "Name=VALUES(Name), "
            "PRODUCE_GIVING=VALUES(PRODUCE_GIVING), "
            "PRODUCE_WANTED=VALUES(PRODUCE_WANTED), "
            "LATITUDE=VALUES(LATITUDE), "
            "LONGITUDE=VALUES(LONGITUDE)"
        )
        cur.execute(
            upsert_sql,
            (
                vendor_id,
                farmer.Name,
                farmer.PRODUCE_GIVING,
                farmer.PRODUCE_WANTED,
                next_lat,
                next_lng,
            ),
        )
        conn.commit()

        cur.execute(
            "SELECT VENDOR_ID, Name, PRODUCE_GIVING, PRODUCE_WANTED, LATITUDE, LONGITUDE FROM profiles WHERE VENDOR_ID=%s",
            (vendor_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=500, detail='Failed to load saved farmer')

        return FarmerOut(**row)
    except Error as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if 'cur' in locals(): cur.close()
        if 'conn' in locals(): conn.close()


@app.get('/farmers', response_model=List[FarmerOut])
def list_farmers():
    try:
        conn = get_conn()
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT VENDOR_ID, Name, PRODUCE_GIVING, PRODUCE_WANTED, LATITUDE, LONGITUDE FROM profiles")
        rows = cur.fetchall() or []
        return [FarmerOut(**r) for r in rows]
    except Error as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if 'cur' in locals(): cur.close()
        if 'conn' in locals(): conn.close()


@app.put('/farmers/{vendor_id}/location')
def update_farmer_location(vendor_id: str, location: LocationUpdate):
    try:
        conn = get_conn()
        cur = conn.cursor()
        query = "UPDATE profiles SET LATITUDE = %s, LONGITUDE = %s WHERE VENDOR_ID = %s"
        cur.execute(query, (location.latitude, location.longitude, vendor_id))
        conn.commit()
        
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Farmer profile not found")
            
        return {"status": "success", "message": "Location updated successfully"}
    except Error as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if 'cur' in locals(): cur.close()
        if 'conn' in locals(): conn.close()


# ---- Trade Transaction Endpoints ----

@app.post('/trades/propose', status_code=status.HTTP_201_CREATED)
def propose_trade(proposal: TradeProposal):
    try:
        conn = get_conn()
        cur = conn.cursor()
        
        try:
            dt_obj = datetime.fromisoformat(proposal.proposed_time.replace("Z", "+00:00"))
        except ValueError:
            dt_obj = datetime.strptime(proposal.proposed_time, "%Y-%m-%d %H:%M:%S")

        query = """
            INSERT INTO trades 
            (sender_id, receiver_id, Sender_note, items_giving, items_receiving, meeting_name, meeting_lat, meeting_lng, proposed_time, status, statusRec)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending', 'pending')
        """
        cur.execute(query, (
            proposal.sender_id,
            proposal.receiver_id,
            proposal.Sender_note,
            proposal.items_giving,
            proposal.items_receiving,
            proposal.meeting_name,
            proposal.meeting_lat,
            proposal.meeting_lng,
            dt_obj,
        ))

        conn.commit()
        return {"status": "success", "message": "Trade request logged successfully"}
    except (Error, ValueError) as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if 'cur' in locals(): cur.close()
        if 'conn' in locals(): conn.close()


@app.put('/trades/{trade_id}/status')
def update_trade_status(trade_id: int, payload: TradeStatusUpdate):
    try:
        conn = get_conn()
        cur = conn.cursor(dictionary=True)

        cur.execute(
            "SELECT trade_id, sender_id, receiver_id FROM trades WHERE trade_id = %s",
            (trade_id,),
        )
        current = cur.fetchone()
        if not current:
            raise HTTPException(status_code=404, detail="Trade ticket item not found")
        # If either party cancels, force both sides to cancelled
        if payload.status == 'cancelled' or payload.statusRec == 'cancelled':
            cur.execute(
                "UPDATE trades SET status = 'cancelled', statusRec = 'cancelled' WHERE trade_id = %s",
                (trade_id,)
            )
            conn.commit()
            return {"status": "success", "message": "Trade cancelled for both parties"}
        set_clauses: list[str] = []
        values: list[Any] = []

        if payload.status is not None and payload.status != '':
            set_clauses.append("status = %s")
            values.append(payload.status)

        if payload.statusRec is not None and payload.statusRec != '':
            set_clauses.append("statusRec = %s")
            values.append(payload.statusRec)

        if payload.Sender_note is not None:
            set_clauses.append("Sender_note = %s")
            values.append(payload.Sender_note)

        if payload.Reciever_note is not None:
            set_clauses.append("Reciever_note = %s")
            values.append(payload.Reciever_note)

        if not set_clauses:
            return {
                "status": "success",
                "message": "No trade fields provided to update",
            }

        set_sql = ", ".join(set_clauses)
        sql = f"UPDATE trades SET {set_sql} WHERE trade_id = %s"
        values.append(trade_id)

        cur.execute(sql, tuple(values))
        conn.commit()

        return {
            "status": "success",
            "message": "Trade updated successfully",
            "updated": {
                "status": payload.status,
                "statusRec": payload.statusRec,
                "Sender_note": payload.Sender_note,
                "Reciever_note": payload.Reciever_note,
            },
        }

    except Error as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if 'cur' in locals(): cur.close()
        if 'conn' in locals(): conn.close()


@app.get('/trades/summary/{vendor_id}')
def get_trades_summary(vendor_id: str):
    try:
        conn = get_conn()
        cur = conn.cursor(dictionary=True)
        
        outgoing_query = """
            SELECT t.*, p.Name as to_name 
            FROM trades t
            JOIN profiles p ON t.receiver_id = p.VENDOR_ID
            WHERE t.sender_id = %s
        """
        cur.execute(outgoing_query, (vendor_id,))
        outgoing_rows = cur.fetchall() or []

        incoming_query = """
            SELECT t.*, p.Name as from_name 
            FROM trades t
            JOIN profiles p ON t.sender_id = p.VENDOR_ID
            WHERE t.receiver_id = %s
        """
        cur.execute(incoming_query, (vendor_id,))
        incoming_rows = cur.fetchall() or []

        formatted_incoming = []
        for row in incoming_rows:
            formatted_incoming.append({
                "trade_id": row["trade_id"],
                "from_vendor_id": row["sender_id"],
                "from_name": row["from_name"],
                "giving": row["items_giving"],
                "receiving": row["items_receiving"],
                "status": row["status"],
                "statusRec": row.get("statusRec"),
                "meeting_name": row["meeting_name"],
                "meeting_lat": row["meeting_lat"],
                "meeting_lng": row["meeting_lng"],
                "proposed_time": row["proposed_time"].isoformat() if isinstance(row["proposed_time"], datetime) else str(row["proposed_time"]),
                "Sender_note": row.get("Sender_note"),
                "Reciever_note": row.get("Reciever_note"),
            })

        formatted_outgoing = []
        for row in outgoing_rows:
            formatted_outgoing.append({
                "trade_id": row["trade_id"],
                "to_vendor_id": row["receiver_id"],
                "to_name": row["to_name"],
                "giving": row["items_giving"],
                "receiving": row["items_receiving"],
                "status": row["status"],
                "meeting_name": row["meeting_name"],
                "meeting_lat": row["meeting_lat"],
                "meeting_lng": row["meeting_lng"],
                "proposed_time": row["proposed_time"].isoformat() if isinstance(row["proposed_time"], datetime) else str(row["proposed_time"]),
                "Sender_note": row.get("Sender_note"),
                "Reciever_note": row.get("Reciever_note"),
            })

        return {
            "vendor_id": vendor_id,
            "incoming": formatted_incoming,
            "outgoing": formatted_outgoing
        }
    except Error as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if 'cur' in locals(): cur.close()
        if 'conn' in locals(): conn.close()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)