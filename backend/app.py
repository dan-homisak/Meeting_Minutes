from __future__ import annotations

import asyncio
from pathlib import Path
from typing import List

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .database import get_db, init_db
from .models import Item, ItemCreate, ItemUpdate


def create_app(static_dir: Path) -> FastAPI:
    init_db()

    app = FastAPI(title="Skeleton App", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    if not static_dir.exists():
        static_dir.mkdir(parents=True, exist_ok=True)

    app.mount("/assets", StaticFiles(directory=static_dir), name="assets")

    shutdown_lock = asyncio.Lock()
    app.state.shutdown_task = None
    app.state.shutdown_counter = 0

    async def cancel_shutdown() -> None:
        async with shutdown_lock:
            app.state.shutdown_counter += 1
            if app.state.shutdown_task:
                app.state.shutdown_task.cancel()
                app.state.shutdown_task = None

    async def schedule_shutdown(delay: float) -> None:
        async with shutdown_lock:
            app.state.shutdown_counter += 1
            token = app.state.shutdown_counter
            if app.state.shutdown_task:
                app.state.shutdown_task.cancel()

            async def trigger() -> None:
                try:
                    await asyncio.sleep(delay)
                    async with shutdown_lock:
                        if token != app.state.shutdown_counter:
                            return
                        app.state.shutdown_task = None
                    event: asyncio.Event | None = getattr(app.state, "shutdown_event", None)
                    if event:
                        event.set()
                except asyncio.CancelledError:
                    pass

            app.state.shutdown_task = asyncio.create_task(trigger())

    @app.middleware("http")
    async def shutdown_guard(request: Request, call_next):
        if request.url.path != "/api/shutdown":
            await cancel_shutdown()
        response = await call_next(request)
        return response

    @app.get("/api/items", response_model=List[Item])
    def list_items(db=Depends(get_db)):
        rows = db.execute("SELECT id, title, description FROM items ORDER BY id DESC").fetchall()
        return [Item(id=row["id"], title=row["title"], description=row["description"]) for row in rows]

    @app.post("/api/items", response_model=Item, status_code=201)
    def create_item(payload: ItemCreate, db=Depends(get_db)):
        cursor = db.execute(
            "INSERT INTO items (title, description) VALUES (?, ?)",
            (payload.title.strip(), payload.description.strip()),
        )
        db.commit()
        item_id = cursor.lastrowid
        return Item(id=item_id, **payload.dict())

    @app.get("/api/items/{item_id}", response_model=Item)
    def get_item(item_id: int, db=Depends(get_db)):
        row = db.execute(
            "SELECT id, title, description FROM items WHERE id = ?",
            (item_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Item not found")
        return Item(id=row["id"], title=row["title"], description=row["description"])

    @app.put("/api/items/{item_id}", response_model=Item)
    def update_item(item_id: int, payload: ItemUpdate, db=Depends(get_db)):
        row = db.execute("SELECT id, title, description FROM items WHERE id = ?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Item not found")

        new_title = payload.title.strip() if payload.title is not None else row["title"]
        new_description = payload.description.strip() if payload.description is not None else row["description"]

        db.execute(
            "UPDATE items SET title = ?, description = ? WHERE id = ?",
            (new_title, new_description, item_id),
        )
        db.commit()

        return Item(id=item_id, title=new_title, description=new_description)

    @app.delete("/api/items/{item_id}", status_code=204)
    def delete_item(item_id: int, db=Depends(get_db)):
        cursor = db.execute("DELETE FROM items WHERE id = ?", (item_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Item not found")
        db.commit()
        return JSONResponse(status_code=204, content={})

    @app.post("/api/shutdown")
    async def shutdown(_: Request):
        await schedule_shutdown(2.0)
        return {"status": "scheduled"}

    async def serve_index() -> FileResponse:
        index_path = static_dir / "index.html"
        return FileResponse(index_path)

    @app.get("/", include_in_schema=False)
    async def index() -> FileResponse:
        return await serve_index()

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str) -> FileResponse:
        # Serve the SPA entrypoint for client-side routes.
        return await serve_index()

    return app
