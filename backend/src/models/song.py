from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class Song(Base):
    __tablename__ = "songs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    artist: Mapped[str | None] = mapped_column(String(200))
    source: Mapped[str] = mapped_column(String(20))
    tempo: Mapped[int] = mapped_column(Integer)
    time_signature: Mapped[list[int]] = mapped_column(JSON)
    key: Mapped[str | None] = mapped_column(String(40))
    notes: Mapped[list[dict]] = mapped_column(JSON)
    measures: Mapped[list[dict]] = mapped_column(JSON, default=list)
    musicxml: Mapped[str] = mapped_column(Text)
    teacher_notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
