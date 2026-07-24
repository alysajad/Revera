from django.conf import settings
from django.contrib.auth import get_user_model
from django.middleware.csrf import get_token
from rest_framework import permissions, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from .permissions import IsAdmin
from .serializers import LoginSerializer, SalesOfficerSerializer, UserSerializer


def set_auth_cookies(response, refresh):
    response.set_cookie("revera_access", str(refresh.access_token), httponly=True, secure=not settings.DEBUG, samesite="Lax", max_age=900)
    response.set_cookie("revera_refresh", str(refresh), httponly=True, secure=not settings.DEBUG, samesite="Lax", max_age=604800)


class LoginView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        refresh = RefreshToken.for_user(serializer.validated_data["user"])
        response = Response({"user": UserSerializer(serializer.validated_data["user"]).data})
        set_auth_cookies(response, refresh)
        return response


class RefreshView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def post(self, request):
        token = request.COOKIES.get("revera_refresh")
        if not token:
            return Response({"detail": "Refresh token missing."}, status=status.HTTP_401_UNAUTHORIZED)
        try:
            refresh = RefreshToken(token)
            user = get_user_model().objects.get(id=refresh["user_id"], is_active=True)
            refresh.blacklist()
            refresh = RefreshToken.for_user(user)
        except Exception:
            return Response({"detail": "Refresh token invalid."}, status=status.HTTP_401_UNAUTHORIZED)
        response = Response(status=status.HTTP_204_NO_CONTENT)
        set_auth_cookies(response, refresh)
        return response


class LogoutView(APIView):
    def post(self, request):
        response = Response(status=status.HTTP_204_NO_CONTENT)
        response.delete_cookie("revera_access")
        response.delete_cookie("revera_refresh")
        return response


class MeView(APIView):
    def get(self, request):
        return Response({"user": UserSerializer(request.user).data})


class CsrfView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def get(self, request):
        return Response({"csrfToken": get_token(request)})


class SalesOfficerViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdmin]
    serializer_class = SalesOfficerSerializer
    queryset = get_user_model().objects.filter(role=get_user_model().Role.SALES_OFFICER).order_by("first_name", "email")

    def destroy(self, request, *args, **kwargs):
        officer = self.get_object()
        if officer.assigned_leads.filter(deleted_at__isnull=True).exists():
            return Response({"detail": "Reassign this officer's active leads before deactivation."}, status=status.HTTP_400_BAD_REQUEST)
        officer.is_active = False
        officer.save(update_fields=["is_active"])
        return Response(status=status.HTTP_204_NO_CONTENT)
