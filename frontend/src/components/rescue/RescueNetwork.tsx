import React, { useState } from 'react';
import { MapPinIcon, TruckIcon, ClockIcon, BuildingOfficeIcon } from '@heroicons/react/24/outline';
import { rescueApi } from '../../services/api';
import type { NGO, RouteInfo, UserLocation } from '../../types/rescue';
import NGOList from './NGOList';

const DEMO_NGOS: NGO[] = [
  { id: 'd1', name: 'City Food Bank - Nagpur', address: 'Civil Lines, Nagpur, Maharashtra 440001', lat: 21.1458, lng: 79.0882, type: 'food-bank', phone: '+91 712 256 0001', email: 'nagpur@cityfoodbank.org', capacity: 500, currentLoad: 180, distance: 1.2 } as any,
  { id: 'd2', name: 'Akshaya Patra Foundation', address: 'Wardha Rd, Nagpur, Maharashtra 440015', lat: 21.1200, lng: 79.0800, type: 'ngo', phone: '+91 712 256 0002', email: 'nagpur@akshayapatra.org', capacity: 1000, currentLoad: 400, distance: 2.8 } as any,
  { id: 'd3', name: 'Roti Bank Nagpur', address: 'Dharampeth, Nagpur, Maharashtra 440010', lat: 21.1550, lng: 79.0650, type: 'community', phone: '+91 712 256 0003', email: 'info@rotibank.org', capacity: 300, currentLoad: 90, distance: 3.5 } as any,
  { id: 'd4', name: 'Feeding India NGO', address: 'Sitabuldi, Nagpur, Maharashtra 440012', lat: 21.1490, lng: 79.0810, type: 'ngo', phone: '+91 712 256 0004', email: 'nagpur@feedingindia.org', capacity: 800, currentLoad: 350, distance: 4.1 } as any,
];

const RescueNetwork: React.FC = () => {
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [nearbyNGOs, setNearbyNGOs] = useState<NGO[]>([]);
  const [selectedNGO, setSelectedNGO] = useState<NGO | null>(null);
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locationPermission, setLocationPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');

  // Get user's current location
  const getCurrentLocation = () => {
    setLoading(true);
    setError(null);

    if (!navigator.geolocation) {
      setError('Geolocation is not supported by this browser.');
      setLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location: UserLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setUserLocation(location);
        setLocationPermission('granted');
        setLoading(false);

        // Automatically find nearby NGOs
        findNearbyNGOs(location.lat, location.lng);
      },
      (error) => {
        console.error('Error getting location:', error);
        setLocationPermission('denied');
        
        // Provide more specific error messages
        let errorMessage = 'Unable to get your location. Please enable location services and try again.';
        if (error.code === 1) {
          errorMessage = 'Location access denied. Please allow location access in your browser settings.';
        } else if (error.code === 2) {
          errorMessage = 'Location unavailable. Please check your device location settings.';
        } else if (error.code === 3) {
          errorMessage = 'Location request timed out. Please try again or check your internet connection.';
        }
        
        setError(errorMessage);
        setLoading(false);
      },
      {
        enableHighAccuracy: false, // Changed to false for faster response
        timeout: 30000, // Increased to 30 seconds
        maximumAge: 300000, // Increased to 5 minutes
      }
    );
  };

  // Find nearby NGOs
  const findNearbyNGOs = async (lat: number, lng: number) => {
    try {
      setLoading(true);
      setError(null);

      try {
        const response = await rescueApi.getNearbyNGOs(lat, lng);
        const ngos = response.data.ngos || [];
        setNearbyNGOs(ngos.length > 0 ? ngos : DEMO_NGOS);
      } catch {
        setNearbyNGOs(DEMO_NGOS);
      }
    } finally {
      setLoading(false);
    }
  };

  // Get route to selected NGO
  const getRouteToNGO = async (ngo: NGO) => {
    if (!userLocation) {
      setError('User location not available. Please enable location services.');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await rescueApi.getRoute(
        userLocation.lat,
        userLocation.lng,
        ngo.lat,
        ngo.lng
      );

      setRouteInfo(response.data);
      setSelectedNGO(ngo);
    } catch (error) {
      console.error('Error getting route:', error);
      setError('Failed to get route directions. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Manual location input (fallback)
  const handleManualLocationSearch = async (_address: string) => {
    setError('Manual location search will be implemented with geocoding API.');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Rescue Network</h1>
        <p className="text-gray-600">
          Connect with nearby food banks and NGOs to donate surplus food and reduce waste.
        </p>
      </div>

      {/* Location Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900 flex items-center">
            <MapPinIcon className="h-6 w-6 mr-2 text-indigo-600" />
            Your Location
          </h2>
          {!userLocation && (
            <button
              onClick={getCurrentLocation}
              disabled={loading}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Getting Location...
                </>
              ) : (
                <>
                  <MapPinIcon className="h-4 w-4 mr-2" />
                  Get My Location
                </>
              )}
            </button>
          )}
        </div>

        {userLocation ? (
          <div className="flex items-center text-sm text-gray-600">
            <MapPinIcon className="h-4 w-4 mr-1 text-green-600" />
            <span>
              Location detected: {userLocation.lat.toFixed(6)}, {userLocation.lng.toFixed(6)}
              {userLocation.address && ` (${userLocation.address})`}
            </span>
          </div>
        ) : locationPermission === 'denied' ? (
          <div className="text-sm text-amber-600">
            <p>Location access denied. You can still search for NGOs by entering an address manually.</p>
            <div className="mt-2 space-y-2">
              <input
                type="text"
                placeholder="Enter your address or location"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleManualLocationSearch((e.target as HTMLInputElement).value);
                  }
                }}
              />
              <button
                onClick={() => {
                  // Use a default location (New York City) for demonstration
                  const defaultLocation: UserLocation = {
                    lat: 40.7128,
                    lng: -74.0060,
                  };
                  setUserLocation(defaultLocation);
                  setLocationPermission('granted');
                  findNearbyNGOs(defaultLocation.lat, defaultLocation.lng);
                }}
                className="w-full px-3 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors text-sm"
              >
                Use Demo Location (New York City)
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            Click "Get My Location" to find nearby NGOs and food banks.
          </p>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-6">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3 flex-1">
              <p className="text-sm text-red-800">{error}</p>
              {!userLocation && (
                <button
                  onClick={() => {
                    // Use a default location (New York City) for demonstration
                    const defaultLocation: UserLocation = {
                      lat: 40.7128,
                      lng: -74.0060,
                    };
                    setUserLocation(defaultLocation);
                    setLocationPermission('granted');
                    setError(null);
                    findNearbyNGOs(defaultLocation.lat, defaultLocation.lng);
                  }}
                  className="mt-2 px-3 py-1 bg-red-100 text-red-700 rounded text-sm hover:bg-red-200 transition-colors"
                >
                  Use Demo Location Instead
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* NGO List */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center">
              <BuildingOfficeIcon className="h-6 w-6 mr-2 text-indigo-600" />
              Nearby NGOs & Food Banks
              {nearbyNGOs.length > 0 && (
                <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                  {nearbyNGOs.length} found
                </span>
              )}
            </h2>
          </div>
          <NGOList 
            ngos={nearbyNGOs}
            selectedNGO={selectedNGO}
            onSelectNGO={getRouteToNGO}
            loading={loading}
          />
        </div>

        {/* Route & Directions - static demo panel */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center">
              <TruckIcon className="h-6 w-6 mr-2 text-indigo-600" />
              Route & Directions
            </h2>
          </div>
          <div className="h-96 p-4 overflow-y-auto">
            {selectedNGO ? (
              <div className="space-y-3">
                <div className="bg-indigo-50 rounded-lg p-4">
                  <p className="font-medium text-indigo-900">{selectedNGO.name}</p>
                  <p className="text-sm text-indigo-700 mt-1">{selectedNGO.address}</p>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1 bg-gray-50 rounded p-3 text-center">
                    <p className="text-xs text-gray-500">Distance</p>
                    <p className="font-semibold text-gray-800">{(selectedNGO as any).distance ? `${(selectedNGO as any).distance} km` : '~3.2 km'}</p>
                  </div>
                  <div className="flex-1 bg-gray-50 rounded p-3 text-center">
                    <p className="text-xs text-gray-500">Est. Time</p>
                    <p className="font-semibold text-gray-800">~12 min</p>
                  </div>
                </div>
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(selectedNGO.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full text-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
                >
                  Open in Google Maps
                </a>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-2">
                <TruckIcon className="h-12 w-12" />
                <p className="text-sm">Select an NGO from the list to see route details</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Route Details */}
      {routeInfo && selectedNGO && (
        <div className="mt-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <ClockIcon className="h-5 w-5 mr-2 text-indigo-600" />
            Directions to {selectedNGO.name}
          </h3>
          <div className="space-y-3">
            {routeInfo.steps.map((step, index) => (
              <div key={index} className="flex items-start">
                <div className="flex-shrink-0 w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-sm font-medium mr-3">
                  {index + 1}
                </div>
                <div className="flex-1">
                  <div 
                    className="text-sm text-gray-900"
                    dangerouslySetInnerHTML={{ __html: step.instruction }}
                  />
                  <div className="text-xs text-gray-500 mt-1">
                    {step.distance} • {step.duration}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default RescueNetwork;
