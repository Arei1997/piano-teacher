"""Single-user password login for a hosted copy of the app.

With APP_PASSWORD unset (running on your own PC) everything is open. With it set, every
/api route except login and health needs the session cookie that /api/login hands out.
"""

import hashlib
import hmac

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from src.config import settings

COOKIE = "pt_session"
PUBLIC_PATHS = {"/api/login", "/api/logout", "/api/health"}
ONE_YEAR = 60 * 60 * 24 * 365

router = APIRouter(prefix="/api", tags=["auth"])


def _token() -> str:
    # Derived from the password too, so changing the password logs every device out.
    message = f"pianoteacher:{settings.app_password}".encode()
    return hmac.new(settings.session_secret.encode(), message, hashlib.sha256).hexdigest()


def is_authenticated(request: Request) -> bool:
    if not settings.app_password:
        return True
    return hmac.compare_digest(request.cookies.get(COOKIE, ""), _token())


async def require_login(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api") and path not in PUBLIC_PATHS and not is_authenticated(request):
        return JSONResponse({"detail": "Please log in."}, status_code=401)
    return await call_next(request)


class LoginRequest(BaseModel):
    password: str


@router.post("/login", status_code=204)
def login(body: LoginRequest, request: Request, response: Response):
    if not settings.app_password:
        return
    if not hmac.compare_digest(body.password.encode(), settings.app_password.encode()):
        raise HTTPException(401, "Wrong password.")
    response.set_cookie(
        COOKIE,
        _token(),
        max_age=ONE_YEAR,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="lax",
    )


@router.post("/logout", status_code=204)
def logout(response: Response):
    response.delete_cookie(COOKIE)
